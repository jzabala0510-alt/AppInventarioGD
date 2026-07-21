import { createApp } from 'vue';
import { createPinia } from 'pinia';
import './styles/tokens.css';
import App from './App.vue';
import { router } from './router';
import { useThemeStore } from './stores/theme';

const app = createApp(App);
app.use(createPinia());
app.use(router);

useThemeStore().aplicar();

app.mount('#app');
