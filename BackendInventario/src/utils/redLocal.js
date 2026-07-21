import os from 'node:os';

// La direccion que hay que mostrarle a la app movil NO puede depender de como
// el navegador llego a esta ruta (podria ser "localhost" si el frontend vive
// en el mismo dispositivo) -- tiene que ser la IP real de la red local de esta
// maquina, la unica que un telefono puede realmente usar para conectarse.
// Se recalcula en cada llamada (no se cachea) para que se adapte sola si el
// dispositivo cambia de red.
//
// Un dispositivo real suele tener mas de un adaptador con IPv4 no interna a la
// vez (WiFi/Ethernet real + una VPN como ProtonVPN/Tailscale/WireGuard). Los
// tuneles de VPN casi siempre usan una mascara /32 (punto a punto, un solo
// host), mientras que una red LAN real usa una mascara mas amplia (/24 tipico)
// -- se usa eso para preferir la LAN real sobre el tunel cuando hay ambos.
export function obtenerIpLocal() {
  const candidatas = [];
  const interfaces = os.networkInterfaces();
  for (const nombre of Object.keys(interfaces)) {
    for (const iface of interfaces[nombre] ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        candidatas.push(iface);
      }
    }
  }
  const lan = candidatas.find((iface) => iface.netmask !== '255.255.255.255');
  return (lan ?? candidatas[0])?.address ?? '127.0.0.1';
}
