<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ApiError } from '../api/client';
import { locationsApi } from '../api';
import { formatDateTime } from '../api/format';
import ErrorNotice from '../components/ErrorNotice.vue';
import { COPY_STATUS_LABELS, type ShelfCopy, type ShelfLocation } from '../types/domain';

const locations = ref<ShelfLocation[]>([]);
const copiesByLocation = ref<Record<string, ShelfCopy[]>>({});
const expandedId = ref<string | null>(null);
const loading = ref(true);
const saving = ref(false);
const error = ref('');
const success = ref('');
const showCreateForm = ref(false);
const editingId = ref<string | null>(null);
const lastDeleted = ref<ShelfLocation | null>(null);

const createForm = reactive({ name: '', note: '' });
const editForm = reactive({ name: '', note: '', sortOrder: 0, version: 0 });

async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    const result = await locationsApi.list();
    locations.value = result.items;
  } catch (caught) {
    error.value = caught instanceof ApiError ? caught.message : '书架位置加载失败';
  } finally {
    loading.value = false;
  }
}

async function toggleCopies(location: ShelfLocation): Promise<void> {
  if (expandedId.value === location.id) {
    expandedId.value = null;
    return;
  }
  expandedId.value = location.id;
  error.value = '';
  try {
    const result = await locationsApi.get(location.id, new URLSearchParams({ pageSize: '100' }));
    copiesByLocation.value = { ...copiesByLocation.value, [location.id]: result.items };
  } catch (caught) {
    error.value = caught instanceof ApiError ? caught.message : '位置上的副本加载失败';
  }
}

function openCreate(): void {
  showCreateForm.value = true;
  editingId.value = null;
  createForm.name = '';
  createForm.note = '';
  error.value = '';
}

function openEdit(location: ShelfLocation): void {
  showCreateForm.value = false;
  editingId.value = location.id;
  editForm.name = location.name;
  editForm.note = location.note ?? '';
  editForm.sortOrder = location.sortOrder;
  editForm.version = location.version;
  error.value = '';
}

async function submitCreate(): Promise<void> {
  saving.value = true;
  error.value = '';
  try {
    await locationsApi.create({ name: createForm.name.trim(), note: createForm.note.trim() || null });
    showCreateForm.value = false;
    success.value = '位置已创建';
    await load();
  } catch (caught) {
    error.value = caught instanceof ApiError ? caught.message : '位置创建失败';
  } finally {
    saving.value = false;
  }
}

async function submitEdit(): Promise<void> {
  if (!editingId.value) return;
  saving.value = true;
  error.value = '';
  try {
    await locationsApi.update(editingId.value, {
      name: editForm.name.trim(),
      note: editForm.note.trim() || null,
      sortOrder: editForm.sortOrder,
      version: editForm.version
    });
    editingId.value = null;
    success.value = '位置已更新';
    await load();
  } catch (caught) {
    error.value = caught instanceof ApiError ? caught.message : '位置更新失败';
  } finally {
    saving.value = false;
  }
}

async function deleteLocation(location: ShelfLocation): Promise<void> {
  if (!window.confirm(`确定删除位置「${location.name}」吗？24 小时内可以撤销。`)) return;
  error.value = '';
  try {
    await locationsApi.delete(location.id, location.version);
    lastDeleted.value = location;
    success.value = '位置已删除，可在 24 小时内撤销';
    await load();
  } catch (caught) {
    error.value = caught instanceof ApiError ? caught.message : '位置删除失败';
  }
}

async function restoreLastDeleted(): Promise<void> {
  if (!lastDeleted.value) return;
  error.value = '';
  try {
    await locationsApi.restore(lastDeleted.value.id);
    lastDeleted.value = null;
    success.value = '删除已撤销';
    await load();
  } catch (caught) {
    error.value = caught instanceof ApiError ? caught.message : '恢复失败';
  }
}

onMounted(load);
</script>

<template>
  <section>
    <header class="page-heading">
      <div>
        <p class="eyebrow">SHELVES</p>
        <h1>书架与位置</h1>
        <p>为实体副本建立存放位置，位置上的每一次移动都会留下记录。</p>
      </div>
      <button class="button button-primary" type="button" @click="openCreate">添加位置</button>
    </header>

    <ErrorNotice :message="error" />
    <div v-if="success" class="success-notice" role="status">
      {{ success }}
      <button v-if="lastDeleted" class="text-button" type="button" @click="restoreLastDeleted">
        撤销删除「{{ lastDeleted.name }}」
      </button>
    </div>

    <form v-if="showCreateForm" class="card inline-editor" @submit.prevent="submitCreate">
      <h3>新增位置</h3>
      <label>位置名称<input v-model="createForm.name" type="text" maxlength="100" required placeholder="例如：客厅书架第 2 层" /></label>
      <label>备注（可选）<input v-model="createForm.note" type="text" maxlength="500" /></label>
      <div class="form-actions">
        <button class="button button-quiet" type="button" @click="showCreateForm = false">取消</button>
        <button class="button button-primary" type="submit" :disabled="saving">保存位置</button>
      </div>
    </form>

    <div v-if="loading" class="state-panel">正在整理书架…</div>
    <div v-else-if="locations.length === 0" class="empty-state card">
      <span class="empty-mark">架</span>
      <h2>还没有任何书架位置</h2>
      <p>先建立一个位置，再把书的实体副本放上去。</p>
      <button class="button button-primary" type="button" @click="openCreate">添加第一个位置</button>
    </div>

    <div v-else class="trace-list">
      <article v-for="location in locations" :key="location.id" class="card trace-card">
        <div class="trace-card-heading">
          <div>
            <span class="trace-type">位置</span>
            <strong>{{ location.name }}</strong>
            <span class="muted"> · {{ location.copyCount }} 册</span>
          </div>
          <div class="button-row">
            <button class="text-button" type="button" @click="toggleCopies(location)">
              {{ expandedId === location.id ? '收起副本' : '查看副本' }}
            </button>
            <button class="text-button" type="button" @click="openEdit(location)">编辑</button>
            <button class="text-button danger-text" type="button" @click="deleteLocation(location)">删除</button>
          </div>
        </div>
        <p v-if="location.note" class="preserve-text">{{ location.note }}</p>
        <p class="muted">更新于 {{ formatDateTime(location.updatedAt) }}</p>

        <form v-if="editingId === location.id" class="inline-editor" @submit.prevent="submitEdit">
          <h3>编辑位置</h3>
          <label>位置名称<input v-model="editForm.name" type="text" maxlength="100" required /></label>
          <label>备注（可选）<input v-model="editForm.note" type="text" maxlength="500" /></label>
          <label>排序（小的在前）<input v-model.number="editForm.sortOrder" type="number" min="0" /></label>
          <div class="form-actions">
            <button class="button button-quiet" type="button" @click="editingId = null">取消</button>
            <button class="button button-primary" type="submit" :disabled="saving">保存修改</button>
          </div>
        </form>

        <div v-if="expandedId === location.id" class="shelf-copy-list">
          <p v-if="(copiesByLocation[location.id] ?? []).length === 0" class="empty-inline">
            这个位置上还没有副本。
          </p>
          <ul v-else class="shelf-copies">
            <li v-for="copy in copiesByLocation[location.id]" :key="copy.id">
              <RouterLink :to="`/books/${copy.bookId}`">{{ copy.bookTitle }}</RouterLink>
              <span> 第 {{ copy.copyNo }} 册</span>
              <span v-if="copy.label">（{{ copy.label }}）</span>
              <span class="status-badge" :data-status="copy.status">{{ COPY_STATUS_LABELS[copy.status] }}</span>
            </li>
          </ul>
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.shelf-copy-list {
  margin-top: 0.8rem;
}

.shelf-copies {
  display: grid;
  gap: 0.4rem;
  margin: 0;
  padding-left: 1.2rem;
}

.shelf-copies li {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.35rem;
}
</style>
