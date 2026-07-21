<script setup>
defineProps({
  size: {
    type: Number,
    default: 200,
  },
});
</script>

<template>
  <img
    src="../assets/img/1.png"
    alt="redes ip"
    :style="{ height: `${size}px`, width: 'auto' }"
  />
</template>
