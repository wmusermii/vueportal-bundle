<script setup lang="ts">
import { ref, watch } from 'vue'

const props = defineProps<{ open: boolean; title: string; wide?: boolean }>()
const emit = defineEmits<{ close: [] }>()
const el = ref<HTMLDialogElement | null>(null)

watch(
  () => props.open,
  (v) => {
    if (v && !el.value?.open) el.value?.showModal()
    if (!v && el.value?.open) el.value.close()
  },
)
</script>

<template>
  <dialog ref="el" :class="['modal', { 'modal-wide': wide }]" @close="emit('close')" @cancel.prevent="emit('close')">
    <div class="modal-head"><h2>{{ title }}</h2></div>
    <div class="modal-body"><slot /></div>
    <div class="modal-foot"><slot name="footer" /></div>
  </dialog>
</template>