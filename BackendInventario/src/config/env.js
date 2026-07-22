import 'dotenv/config';

// DB_* ya NO son obligatorias para arrancar: una instalacion nueva (o una
// tienda que se muda de base de datos) puede no tener eso configurado todavia,
// y el backend debe levantar igual para que la pantalla Configuracion > Base
// de datos pueda arreglarlo desde el frontend. JWT_SECRET_BASE64 si es
// obligatoria porque no tiene relacion con la BD (login/tokens).
const required = ['JWT_SECRET_BASE64'];

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Falta la variable de entorno ${key} (revisa el archivo .env)`);
  }
}

export const config = {
  port: Number(process.env.PORT || 8085),
  basePath: process.env.BASE_PATH || '/recursos',
  db: {
    host: process.env.DB_HOST || null,
    port: Number(process.env.DB_PORT || 1433),
    instance: process.env.DB_INSTANCE || undefined,
    database: process.env.DB_NAME || null,
    user: process.env.DB_USER || null,
    password: process.env.DB_PASSWORD || null,
  },
  jwt: {
    // Mismo formato que el backend Java: el secreto es la version decodificada
    // en Base64 del string configurado, usado como llave HMAC-SHA256 cruda.
    secret: Buffer.from(process.env.JWT_SECRET_BASE64, 'base64'),
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
  },
  actualizador: {
    // Sin clave configurada el modulo simplemente rechaza cualquier intento
    // de actualizar (no crashea el arranque por esto).
    clave: process.env.UPDATER_PASSWORD || null,
    repoOwner: process.env.UPDATER_REPO_OWNER || null,
    repoName: process.env.UPDATER_REPO_NAME || null,
    rama: process.env.UPDATER_REPO_BRANCH || 'main',
  },
};
