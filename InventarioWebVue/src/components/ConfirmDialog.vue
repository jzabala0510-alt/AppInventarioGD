<script setup>
defineProps({
  open: {
    type: Boolean,
    default: false,
  },
  titulo: {
    type: String,
    default: 'Confirmar',
  },
  mensaje: {
    type: String,
    required: true,
  },
  textoConfirmar: {
    type: String,
    default: 'Confirmar',
  },
  peligroso: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(['confirmar', 'cancelar']);
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="overlay" @click.self="emit('cancelar')">
      <div class="dialog" role="dialog" aria-modal="true">
        <h3>{{ titulo }}</h3>
        <p>{{ mensaje }}</p>
        <div class="acciones">
          <button type="button" class="btn" @click="emit('cancelar')">Cancelar</button>
          <button
            type="button"
            class="btn"
            :class="peligroso ? 'btn-danger' : 'btn-primary'"
            @click="emit('confirmar')"
          >
            {{ textoConfirmar }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(20, 20, 18, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.dialog {
  background: var(--bg-surface);
  border-radius: var(--radius-lg);
  padding: 1.5rem;
  width: min(400px, 90vw);
  box-shadow: var(--shadow-md);
}

.dialog p {
  color: var(--text-secondary);
  margin: 0.5rem 0 1.25rem;
}

.acciones {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
