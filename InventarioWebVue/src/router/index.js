import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '../stores/auth';

const routes = [
  {
    path: '/login',
    name: 'login',
    component: () => import('../views/LoginView.vue'),
    meta: { public: true },
  },
  {
    path: '/',
    component: () => import('../layouts/AppShell.vue'),
    redirect: { name: 'inicio' },
    children: [
      {
        path: 'inicio',
        name: 'inicio',
        component: () => import('../views/InicioView.vue'),
      },
      {
        path: 'conteos/nuevo',
        name: 'conteo-nuevo',
        component: () => import('../views/ConteoNuevoView.vue'),
      },
      {
        path: 'configuracion',
        name: 'configuracion',
        component: () => import('../views/ConfiguracionView.vue'),
        // Publica a proposito: si la base de datos no esta configurada (backend
        // recien instalado, o cambio de tienda), nadie puede iniciar sesion --
        // esta pantalla tiene que ser alcanzable sin sesion para poder arreglarlo.
        meta: { public: true },
      },
      {
        path: 'actualizador',
        name: 'actualizador',
        component: () => import('../views/ActualizadorView.vue'),
      },
      {
        path: 'conteos/:id',
        name: 'conteo-detalle',
        component: () => import('../views/DetalleView.vue'),
        props: (route) => ({ id: Number(route.params.id) }),
      },
      {
        path: 'conteos/:id/articulo',
        name: 'conteo-detalle-articulo',
        component: () => import('../views/DetalleArticuloView.vue'),
        props: (route) => ({ id: Number(route.params.id), ...route.query }),
      },
    ],
  },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach((to) => {
  const auth = useAuthStore();
  if (!to.meta.public && !auth.estaAutenticado) {
    return { name: 'login' };
  }
  if (to.name === 'login' && auth.estaAutenticado) {
    return { name: 'inicio' };
  }
  return true;
});
