<script setup>
defineProps({
  size: {
    type: Number,
    default: 24,
  },
});
</script>

<template>
  <span
    class="spinner"
    role="status"
    aria-label="Cargando"
    :style="{ width: `${size}px`, height: `${size}px` }"
  />
</template>

<style scoped>
.spinner {
  display: inline-block;
  border: 2.5px solid var(--border);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: spin 700ms linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
