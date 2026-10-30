// Brote: un brote que sube por un camino y desbloquea logros. El estado del camino sale de los
// eventos reales del contrato; la intro (12 s) es una animación guionada para el pitch.
const NS = 'http://www.w3.org/2000/svg';
// Camino sinuoso de abajo hacia arriba en un lienzo de 320 x 520.
const CAMINO = 'M60 490 C 60 430, 260 450, 250 390 S 60 350, 70 290 S 260 250, 250 190 S 90 150, 160 60';
const DURACION_PASO = 900;

function el(nombre, attrs = {}, hijos = []) {
  const nodo = document.createElementNS(NS, nombre);
  for (const [k, v] of Object.entries(attrs)) nodo.setAttribute(k, v);
  hijos.forEach((h) => nodo.append(h));
  return nodo;
}

function sinMovimiento() {
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

export function crearBrote(contenedor, logros) {
  contenedor.replaceChildren();
  const svg = el('svg', { viewBox: '0 0 320 520', role: 'img', 'aria-label': 'Camino de Brote con seis logros' });
  const ruta = el('path', { d: CAMINO, class: 'brote-camino', fill: 'none' });
  const progreso = el('path', { d: CAMINO, class: 'brote-progreso', fill: 'none' });
  svg.append(ruta, progreso);
  const largo = ruta.getTotalLength();
  progreso.style.strokeDasharray = String(largo);
  progreso.style.strokeDashoffset = String(largo);

  const fracciones = logros.map((_, i) => (i + 1) / logros.length);
  const nodos = logros.map((logro, i) => {
    const p = ruta.getPointAtLength(largo * fracciones[i] * 0.97);
    const lado = p.x > 160 ? -1 : 1;
    const g = el('g', { class: 'brote-logro', transform: `translate(${p.x} ${p.y})` });
    const medalla = el('circle', { r: 13, class: 'brote-medalla' });
    const numero = el('text', { class: 'brote-numero', 'text-anchor': 'middle', y: 4 });
    numero.textContent = String(i + 1);
    const etiqueta = el('text', { class: 'brote-etiqueta', x: lado * 22, y: 4, 'text-anchor': lado > 0 ? 'start' : 'end' });
    etiqueta.textContent = logro.titulo;
    g.append(medalla, numero, etiqueta);
    svg.append(g);
    return g;
  });

  // Brote: tallo, dos hojas y ojos. Se mueve con transform.
  const brote = el('g', { class: 'brote-personaje' }, [
    el('path', { d: 'M0 0 C 0 -8, 0 -14, 0 -20', class: 'brote-tallo', fill: 'none' }),
    el('ellipse', { cx: -9, cy: -22, rx: 9, ry: 5, class: 'brote-hoja', transform: 'rotate(-25 -9 -22)' }),
    el('ellipse', { cx: 9, cy: -22, rx: 9, ry: 5, class: 'brote-hoja', transform: 'rotate(25 9 -22)' }),
    el('circle', { cx: 0, cy: 4, r: 11, class: 'brote-cuerpo' }),
    el('circle', { cx: -4, cy: 2, r: 1.8, class: 'brote-ojo' }),
    el('circle', { cx: 4, cy: 2, r: 1.8, class: 'brote-ojo' }),
  ]);
  svg.append(brote);
  contenedor.append(svg);

  let actual = 0; // fracción 0..1 del recorrido donde está Brote
  let animacion = null;
  const desbloqueados = new Set();

  function colocar(f) {
    const p = ruta.getPointAtLength(largo * f * 0.97);
    brote.setAttribute('transform', `translate(${p.x} ${p.y - 14})`);
    progreso.style.strokeDashoffset = String(largo * (1 - f * 0.97));
    actual = f;
  }
  colocar(0);

  function moverA(destino) {
    cancelAnimationFrame(animacion);
    if (sinMovimiento()) return colocar(destino);
    const desde = actual;
    const t0 = performance.now();
    const paso = (t) => {
      const k = Math.min(1, (t - t0) / DURACION_PASO);
      const suave = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      colocar(desde + (destino - desde) * suave);
      if (k < 1) animacion = requestAnimationFrame(paso);
    };
    animacion = requestAnimationFrame(paso);
  }

  function marcar(indices) {
    nodos.forEach((g, i) => g.classList.toggle('logrado', indices.has(i)));
  }

  return {
    // `claves` es el conjunto de claves de logros ya alcanzados.
    actualizar(claves) {
      const indices = new Set();
      logros.forEach((l, i) => claves.has(l.key) && indices.add(i));
      // Brote llega hasta el último logro alcanzado en orden, no salta por encima de uno pendiente.
      let tope = 0;
      while (indices.has(tope)) tope++;
      const nuevos = [...indices].some((i) => !desbloqueados.has(i));
      indices.forEach((i) => desbloqueados.add(i));
      marcar(indices);
      if (nuevos || tope !== Math.round(actual * logros.length)) moverA(fracciones[tope - 1] ?? 0);
    },
    // Intro de ~12 s para el pitch: sube desbloqueando los seis logros con subtítulos.
    async intro(mostrarSubtitulo, pausaMs = 1600) {
      const previo = new Set(desbloqueados);
      colocar(0);
      marcar(new Set());
      for (let i = 0; i < logros.length; i++) {
        mostrarSubtitulo(`${logros[i].titulo}: ${logros[i].detalle}`);
        marcar(new Set([...Array(i + 1).keys()]));
        moverA(fracciones[i]);
        await new Promise((r) => setTimeout(r, sinMovimiento() ? 800 : pausaMs));
      }
      mostrarSubtitulo('');
      this.actualizar(new Set(logros.filter((_, i) => previo.has(i)).map((l) => l.key)));
      if (previo.size === 0) {
        marcar(new Set());
        moverA(0);
      }
    },
  };
}
