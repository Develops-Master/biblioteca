#!/bin/bash
# SIGIE — lanzador para macOS/Linux.
# Doble clic (en Mac puede pedir permiso la primera vez: clic derecho > Abrir)
# o ejecutar desde Terminal: ./Iniciar_SIGIE_Mac.command

cd "$(dirname "$0")"

echo "========================================================="
echo "  SIGIE - Sistema de Gestión de Inventario Escolar"
echo "  Carpeta: $(pwd)"
echo "========================================================="
echo

if ! command -v node >/dev/null 2>&1; then
  echo "[!] No se encontró Node.js en esta computadora."
  echo "    Instálalo desde https://nodejs.org (versión LTS) y vuelve a ejecutar este archivo."
  open "https://nodejs.org/es/download" 2>/dev/null
  read -p "Presiona Enter para salir..."
  exit 1
fi

if ! node -e "const v=process.versions.node.split('.').map(Number);process.exit((v[0]>22||(v[0]===22&&v[1]>=13))?0:1)" 2>/dev/null; then
  echo "[!] Tu Node.js ($(node -v)) es antiguo. SIGIE necesita Node.js 22.13 o superior"
  echo "    (trae incluida la base de datos SQLite). Instala la versión LTS desde https://nodejs.org"
  open "https://nodejs.org/es/download" 2>/dev/null
  read -p "Presiona Enter para salir..."
  exit 1
fi

mkdir -p data

echo "Iniciando el servidor local..."
echo "Base de datos (SQLite): $(pwd)/data/sigie.db"
echo "No cierres esta ventana mientras uses el sistema."
echo

( sleep 2 && open "http://localhost:3000/" 2>/dev/null || xdg-open "http://localhost:3000/" 2>/dev/null ) &

node server.js
