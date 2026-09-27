<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ApiError } from '../api/client';
import { copyApi, locationApi } from '../api';
import { formatDateTime } from '../api/format';
import {
  COPY_MOVE_LABELS,
  COPY_STATUS_LABELS,
  type BookCopy,
  type CopyLocationEvent,
  type ShelfLocation
} from '../types/domain';

const props = defineProps<{ bookId: string; initialCopies: BookCopy[] }>();
const emit = defineEmits<{ (event: 'changed'): void }>();

const copies = ref<BookCopy[]>(props.initialCopies);
const locations = ref<ShelfLocation[]>([]);
const activeLocations = computed(() => locations.value.filter((location) => location.status === 'ACTIVE'));

const mode = ref<'NONE' | 'CREATE' | 'EDIT'>('NONE');
const moveTarget = ref<BookCopy | null>(null);
const archiveTarget = ref<BookCopy | null>(null);
const historyTarget = ref<BookCopy | null>(null);
const historyEvents = ref<CopyLocationEvent[]>([]);
const historyLoading = ref(false);
const lastDeleted = ref<{ id: string; label: string } | null>(null);
const saving = ref(false);
const error = ref('');
const success = ref('');

const copyForm = reactive({
  label: '',
  condition: '',
  acquiredAt: '',
  notes: '',
  locationId: '',
  note: ''
});
const moveForm = reactive({ locationId: '', note: '' });
const archiveForm = reactive({ note: '' });

const editingId = ref<string | null>(null);

function locationName(copy: BookCopy): string {
  return copy.location ? copy.location.name : '未上架';
}

function resetCopyForm(): void {
  copyForm.label = '';
  copyForm.condition = '';
  copyForm.acquiredAt = '';
  copyForm.notes = '';
  copyForm.locationId = '';
  copyForm.note = '';
}

function openCreate(): void {
  mode.value = 'CREATE';
  editingId.value = null;
  resetCopyForm();
  error.value = '';
}

function openEdit(copy: BookCopy): void {
  mode.value = 'EDIT';
  editingId.value = copy.id;
  copyForm.label = copy.label ?? '';
  copyForm.condition = copy.condition ?? '';
  copyForm.acquiredAt = copy.acquiredAt ? copy.acquiredAt.slice(0, 10) : '';
  copyForm.notes = copy.notes ?? '';
  copyForm.locationId = copy.location?.id ?? '';
  copyForm.note = '';
  error.value = '';
}

function closeForm(): void {
  mode.value = 'NONE';
  editingId.value = null;
  resetCopyForm();
}

async function reload(): Promise<void> {
  const result = await copyApi.listForBook(props.bookId);
  copies.value = result.items;
  emit('changed');
}

async function loadLocations(): Promise<void> {
  const result = await locationApi.list(new URLSearchParams({ page: '1', pageSize: '100', status: 'ALL' }));
  locations.value = result.items;
}

function buildAcquiredAt(): string | null {
  if (!copyForm.acquiredAt) return null;
  const date = new Date(`${copyForm.acquiredAt}T12:00:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function submitCopy(): Promise<void> {
  saving.value = true;
  error.value = '';
  try {
    const body = {
      label: copyForm.label.trim() || null,
      condition: copyForm.condition.trim() || null,
      acquiredAt: buildAcquiredAt(),
      notes: copyForm.notes.trim() || null
    };
    if (mode.value === 'CREATE') {
      await copyApi.create(props.bookId, {
        ...body,
        locationId: copyForm.locationId || null,
        note: copyForm.note.trim() || null
      });
      success.value = '实体副本档案已建立';
    } else if (editingId.value) {
      const target = copies.value.find((copy) => copy.id === editingId.value);
      await copyApi.update(editingId.value, { ...body, version: target?.version ?? 0 });
      success.value = '副本档案已更新';
    }
    closeForm();
    await reload();
  } catch (caught) {
    error.value = caught instanceof ApiError ? caught.message : '保存失败，请检查输入';
  } finally {
    saving.value = false;
  }
}

function openMove(copy: BookCopy): void {
  moveTarget.value = copy;
  moveForm.locationId = copy.location?.id ?? '';
  moveForm.note = '';
  error.value = '';
}

async function submitMove(): Promise<void> {
  if (!moveTarget.value) return;
  saving.value = true;
  error.value = '';
  try {
    const result = await copyApi.move(moveTarget.value.id, {
      locationId: moveForm.locationId || null,
      note: moveForm.note.trim() || null,
      version: moveTarget.value.version
    });
    moveTarget.value = null;
    success.value = result.unchanged ? '副本本就在该位置' : '副本已移动，迁移记录已写入审计';
    await reload();
  } catch (caught) {
    error.value = caught instanceof ApiError ? caught.message : '移动失败';
  } finally {
    saving.value = false;
  }
}

function openArchive(copy: BookCopy): void {
  archiveTarget.value = copy;
  archiveForm.note = '';
  error.value = '';
}

async function submitArchive(): Promise<void> {
  if (!archiveTarget.value) return;
  saving.value = true;
  error.value = '';
  try {
    await copyApi.archive(archiveTarget.value.id, {
      note: archiveForm.note.trim() || null,
      version: archiveTarget.value.version
    });
    archiveTarget.value = null;
    success.value = '副本已归档并移出书架';
    await reload();
  } catch (caught) {
    error.value = caught instanceof ApiError ? caught.message : '归档失败';
  } finally {
    saving.value = false;
  }
}

async function unarchive(copy: BookCopy): Promise<void> {
  try {
    // Come back unassigned so the user deliberately chooses a new shelf.
    await copyApi.unarchive(copy.id, { locationId: null, version: copy.version });
    success.value = '副本已取消归档，请重新指定位置';
    await reload();
  } catch (caught) {
    error.value = caught instanceof ApiError ? caught.message : '取消归档失败';
  }
}

async function deleteCopy(copy: BookCopy): Promise<void> {
  if (
    !window.confirm(
      `确定删除第 ${copy.copyNumber} 册副本吗？24 小时内可以撤销，其他同书副本的位置与归属不受影响。`
    )
  ) {
    return;
  }
  try {
    await copyApi.delete(copy.id, copy.version);
    lastDeleted.value = { id: copy.id, label: `第 ${copy.copyNumber} 册副本` };
    success.value = '副本已删除，可在 24 小时内撤销；其他册未受影响';
    await reload();
  } catch (caught) {
    error.value = caught instanceof ApiError ? caught.message : '删除副本失败';
  }
}

async function restoreCopy(): Promise<void> {
  if (!lastDeleted.value) return;
  try {
    await copyApi.restore(lastDeleted.value.id);
    lastDeleted.value = null;
    success.value = '副本已恢复（未分配位置，请重新上架）';
    await reload();
  } catch (caught) {
    error.value = caught instanceof ApiError ? caught.message : '恢复失败';
  }
}

async function openHistory(copy: BookCopy): Promise<void> {
  historyTarget.value = copy;
  historyEvents.value = [];
  historyLoading.value = true;
  try {
    const result = await copyApi.history(copy.id);
    historyEvents.value = result.items;
  } catch (caught) {
    error.value = caught instanceof ApiError ? caught.message : '迁移历史加载失败';
  } finally {
    historyLoading.value = false;
  }
}

onMounted(loadLocations);
</script>

<template>
  <div class="copies-panel">
    <div class="section-heading">
      <div>
        <h2>实体副本（{{ copies.length }} 册）</h2>
        <p class="muted">同一本书可以登记多册；每一册的位置和迁移历史独立保存。</p>
      </div>
      <button class="button" type="button" @click="openCreate">登记一册副本</button>
    </div>

    <p v-if="error" class="error-notice">{{ error }}</p>
    <div v-if="success" class="success-notice" role="status">
      {{ success }}
      <button v-if="lastDeleted" class="text-button" type="button" @click="restoreCopy">
        撤销删除「{{ lastDeleted.label }}」
      </button>
    </div>

    <form v-if="mode !== 'NONE'" class="inline-editor" @submit.prevent="submitCopy">
      <h3>{{ mode === 'CREATE' ? '登记实体副本' : `编辑第 ${copies.find((c) => c.id === editingId)?.copyNumber} 册` }}</h3>
      <div class="form-grid compact-grid">
        <label>
          册别标签（可选）
          <input v-model="copyForm.label" type="text" maxlength="300" placeholder="例如：初版 / 签名本" />
        </label>
        <label>
          品相（可选）
          <input v-model="copyForm.condition" type="text" maxlength="100" placeholder="例如：九品" />
        </label>
      </div>
      <div class="form-grid compact-grid">
        <label>
          入藏日期（可选）
          <input v-model="copyForm.acquiredAt" type="date" />
        </label>
        <label v-if="mode === 'CREATE'">
          当前位置（可选）
          <select v-model="copyForm.locationId">
            <option value="">暂不上架</option>
            <option v-for="location in activeLocations" :key="location.id" :value="location.id">
              {{ location.name }}
            </option>
          </select>
        </label>
      </div>
      <label>
        备注（可选）
        <textarea v-model="copyForm.notes" rows="3" maxlength="5000" placeholder="来源、题字、磨损等只与这一册有关的信息" />
      </label>
      <label v-if="mode === 'CREATE'">
        上架说明（可选，将写入迁移历史）
        <input v-model="copyForm.note" type="text" maxlength="1000" />
      </label>
      <div class="form-actions">
        <button class="button button-quiet" type="button" @click="closeForm">取消</button>
        <button class="button button-primary" type="submit" :disabled="saving">保存副本</button>
      </div>
    </form>

    <ul v-if="copies.length" class="copy-list">
      <li v-for="copy in copies" :key="copy.id" class="copy-card">
        <div class="copy-main">
          <div class="copy-heading">
            <span class="trace-type">第 {{ copy.copyNumber }} 册</span>
            <span class="status-badge" :data-status="copy.status === 'SHELVED' ? 'READING' : 'PAUSED'">
              {{ COPY_STATUS_LABELS[copy.status] }}
            </span>
          </div>
          <p class="copy-line">
            <strong>位置：</strong>{{ locationName(copy) }}
          </p>
          <p v-if="copy.label" class="copy-line"><strong>册别：</strong>{{ copy.label }}</p>
          <p v-if="copy.condition" class="copy-line"><strong>品相：</strong>{{ copy.condition }}</p>
          <p v-if="copy.acquiredAt" class="copy-line">
            <strong>入藏：</strong>{{ formatDateTime(copy.acquiredAt) }}
          </p>
          <p v-if="copy.notes" class="copy-line preserve-text">{{ copy.notes }}</p>
          <p class="muted">更新于 {{ formatDateTime(copy.updatedAt) }}</p>
        </div>
        <div class="copy-actions">
          <button class="text-button" type="button" @click="openHistory(copy)">迁移历史</button>
          <button class="text-button" type="button" @click="openEdit(copy)">编辑档案</button>
          <button v-if="copy.status === 'SHELVED'" class="text-button" type="button" @click="openMove(copy)">
            移动位置
          </button>
          <button v-if="copy.status === 'SHELVED'" class="text-button" type="button" @click="openArchive(copy)">
            归档
          </button>
          <button v-else class="text-button" type="button" @click="unarchive(copy)">取消归档</button>
          <button class="text-button danger-text" type="button" @click="deleteCopy(copy)">删除副本</button>
        </div>
      </li>
    </ul>
    <p v-else class="empty-inline">还没有登记实体副本。同一本书有多册（例如初版和再版）时可以分别记录。</p>

    <div v-if="moveTarget" class="modal-backdrop" role="dialog" aria-modal="true" @click.self="moveTarget = null">
      <form class="card modal-card" @submit.prevent="submitMove">
        <h3>移动第 {{ moveTarget.copyNumber }} 册</h3>
        <p class="muted">当前位置：{{ locationName(moveTarget) }}。移动会写入不可修改的迁移历史。</p>
        <label>
          新位置
          <select v-model="moveForm.locationId">
            <option value="">移出书架（不分配位置）</option>
            <option v-for="location in activeLocations" :key="location.id" :value="location.id">
              {{ location.name }}
            </option>
          </select>
        </label>
        <label>
          迁移原因（可选）
          <input v-model="moveForm.note" type="text" maxlength="1000" />
        </label>
        <div class="form-actions">
          <button class="button button-quiet" type="button" @click="moveTarget = null">取消</button>
          <button class="button button-primary" type="submit" :disabled="saving">确认移动</button>
        </div>
      </form>
    </div>

    <div v-if="archiveTarget" class="modal-backdrop" role="dialog" aria-modal="true" @click.self="archiveTarget = null">
      <form class="card modal-card" @submit.prevent="submitArchive">
        <h3>归档第 {{ archiveTarget.copyNumber }} 册</h3>
        <p class="muted">归档后该副本会从当前位置移出，但档案与迁移历史保留。</p>
        <label>
          归档原因（可选）
          <input v-model="archiveForm.note" type="text" maxlength="1000" />
        </label>
        <div class="form-actions">
          <button class="button button-quiet" type="button" @click="archiveTarget = null">取消</button>
          <button class="button button-primary" type="submit" :disabled="saving">确认归档</button>
        </div>
      </form>
    </div>

    <div v-if="historyTarget" class="modal-backdrop" role="dialog" aria-modal="true" @click.self="historyTarget = null">
      <div class="card modal-card">
        <h3>第 {{ historyTarget.copyNumber }} 册的位置迁移历史</h3>
        <p v-if="historyLoading" class="muted">正在读取迁移记录…</p>
        <ol v-else-if="historyEvents.length" class="history-list">
          <li v-for="event in historyEvents" :key="event.id" class="history-item">
            <div class="history-heading">
              <strong>{{ COPY_MOVE_LABELS[event.action] }}</strong>
              <time>{{ formatDateTime(event.occurredAt) }}</time>
            </div>
            <p class="copy-line">
              {{ event.fromName ?? '（无位置）' }} → {{ event.toName ?? '（移出书架）' }}
            </p>
            <p v-if="event.note" class="muted preserve-text">{{ event.note }}</p>
          </li>
        </ol>
        <p v-else class="empty-inline">暂无迁移记录。</p>
        <div class="form-actions">
          <button class="button button-quiet" type="button" @click="historyTarget = null">关闭</button>
        </div>
      </div>
    </div>
  </div>
</template>
