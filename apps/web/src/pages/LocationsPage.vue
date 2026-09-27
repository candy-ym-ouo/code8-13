<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ApiError } from '../api/client';
import { locationApi } from '../api';
import { formatDateTime } from '../api/format';
import ErrorNotice from '../components/ErrorNotice.vue';
import { LOCATION_STATUS_LABELS, type ShelfLocation } from '../types/domain';

const locations = ref<ShelfLocation[]>([]);
const loading = ref(true);
const saving = ref(false);
const error = ref('');
const success = ref('');
const filter = ref<'ALL' | 'ACTIVE' | 'ARCHIVED'>('ACTIVE');
const editingId = ref<string | null>(null);
const form = reactive({ name: '', description: '' });

async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    const result = await locationApi.list(
      new URLSearchParams({ page: '1', pageSize: '100', status: filter.value })
    );
    locations.value = result.items;
  } catch (caught) {
    error.value = caught instanceof ApiError ? caught.message : '书架位置加载失败';
  } finally {
    loading.value = false;
  }
}

function resetForm(): void {
  editingId.value = null;
  form.name = '';
  form.description = '';
}

function openEdit(location: ShelfLocation): void {
  editingId.value = location.id;
  form.name = location.name;
  form.description = location.description ?? '';
}

async function submit(): Promise<void> {
  if (!form.name.trim()) {
    error.value = '请输入位置名称';
    return;
  }
  saving.value = true;
  error.value = '';
  try {
    const body = { name: form.name.trim(), description: form.description.trim() || null };
    if (editingId.value) {
      await locationApi.update(editingId.value, body);
      success.value = '书架位置已更新';
    } else {
      await locationApi.create(body);
      success.value = '书架位置已创建';
    }
    resetForm();
    await load();
  } catch (caught) {
    error.value = caught instanceof ApiError ? caught.message : '保存失败';
  } finally {
    saving.value = false;
  }
}

async function archive(location: ShelfLocation): Promise<void> {
  if (
    !window.confirm(
      `归档位置「${location.name}」？归档后不能再放入副本，历史迁移记录仍会保留。`
    )
  ) {
    return;
  }
  try {
    await locationApi.archive(location.id);
    success.value = '位置已归档';
    await load();
  } catch (caught) {
    error.value = caught instanceof ApiError ? caught.message : '归档失败';
  }
}

async function unarchive(location: ShelfLocation): Promise<void> {
  try {
    await locationApi.unarchive(location.id);
    success.value = '位置已恢复使用';
    await load();
  } catch (caught) {
    error.value = caught instanceof ApiError ? caught.message : '取消归档失败';
  }
}

async function remove(location: ShelfLocation): Promise<void> {
  if (!window.confirm(`确定删除位置「${location.name}」吗？此操作不可恢复。`)) return;
  try {
    await locationApi.delete(location.id);
    success.value = '位置已删除';
    await load();
  } catch (caught) {
    error.value = caught instanceof ApiError ? caught.message : '删除失败';
  }
}

onMounted(load);
</script>

<template>
  <section>
    <header class="page-heading">
      <div>
        <p class="eyebrow">WHERE THE BOOKS LIVE</p>
        <h1>书架位置</h1>
        <p>记录实体书现在放在哪里；移动和归档都会留下审计记录。</p>
      </div>
    </header>

    <ErrorNotice :message="error" />
    <div v-if="success" class="success-notice" role="status">{{ success }}</div>

    <div class="locations-layout">
      <form class="card form-stack" @submit.prevent="submit">
        <h2>{{ editingId ? '编辑位置' : '新增位置' }}</h2>
        <label>
          名称
          <input v-model="form.name" type="text" maxlength="200" placeholder="例如：客厅左书柜第二层" required />
        </label>
        <label>
          备注（可选）
          <textarea v-model="form.description" rows="3" maxlength="1000" placeholder="例如：靠阳台一侧，避免阳光直晒" />
        </label>
        <div class="form-actions">
          <button v-if="editingId" class="button button-quiet" type="button" @click="resetForm">取消编辑</button>
          <button class="button button-primary" type="submit" :disabled="saving">
            {{ editingId ? '保存修改' : '创建位置' }}
          </button>
        </div>
      </form>

      <div class="card">
        <div class="section-heading">
          <h2>位置列表</h2>
          <div class="tabs" role="tablist">
            <button
              class="tab"
              :class="{ active: filter === 'ACTIVE' }"
              type="button"
              role="tab"
              :aria-selected="filter === 'ACTIVE'"
              @click="filter = 'ACTIVE'; load()"
            >
              使用中
            </button>
            <button
              class="tab"
              :class="{ active: filter === 'ARCHIVED' }"
              type="button"
              role="tab"
              :aria-selected="filter === 'ARCHIVED'"
              @click="filter = 'ARCHIVED'; load()"
            >
              已归档
            </button>
            <button
              class="tab"
              :class="{ active: filter === 'ALL' }"
              type="button"
              role="tab"
              :aria-selected="filter === 'ALL'"
              @click="filter = 'ALL'; load()"
            >
              全部
            </button>
          </div>
        </div>

        <div v-if="loading" class="state-panel">正在查看书架…</div>
        <p v-else-if="locations.length === 0" class="empty-inline">还没有书架位置，先在左侧创建一个。</p>
        <ul v-else class="location-list">
          <li v-for="location in locations" :key="location.id" class="location-item">
            <div class="location-info">
              <div class="location-heading">
                <strong>{{ location.name }}</strong>
                <span class="status-badge" :data-status="location.status === 'ACTIVE' ? 'READING' : 'PAUSED'">
                  {{ LOCATION_STATUS_LABELS[location.status] }}
                </span>
              </div>
              <p v-if="location.description" class="muted preserve-text">{{ location.description }}</p>
              <p class="muted">
                在架副本 {{ location.activeCopyCount }} 册 · 更新于 {{ formatDateTime(location.updatedAt) }}
              </p>
            </div>
            <div class="button-row">
              <button class="text-button" type="button" @click="openEdit(location)">编辑</button>
              <button
                v-if="location.status === 'ACTIVE'"
                class="text-button"
                type="button"
                @click="archive(location)"
              >
                归档
              </button>
              <button v-else class="text-button" type="button" @click="unarchive(location)">取消归档</button>
              <button
                v-if="location.activeCopyCount === 0"
                class="text-button danger-text"
                type="button"
                @click="remove(location)"
              >
                删除
              </button>
            </div>
          </li>
        </ul>
      </div>
    </div>
  </section>
</template>
