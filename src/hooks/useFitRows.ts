import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Medición de la caja disponible, para poder paginar en vez de desplazar.
 *
 * Es la pieza que permite cumplir «todo cabe en pantalla» con listas que por
 * naturaleza no tienen final: una plantilla de cuarenta personas, un libro de
 * fichajes de cuatro años. En vez de un área que se desplaza, se mide el hueco
 * real y se muestra exactamente lo que entra; el resto se pagina.
 *
 * Se mide con `ResizeObserver` y no con una constante por punto de ruptura
 * porque la altura real depende de demasiadas cosas —barra del navegador en el
 * móvil, teclado abierto, pantalla partida, zoom del sistema— y una constante
 * acierta en el simulador y falla en el dispositivo.
 *
 * El `ref` es una FUNCIÓN, no un objeto. Con un ref de objeto y un `useEffect`
 * la medición se pierde cuando la lista se monta después de cargar los datos:
 * al ejecutarse el efecto el nodo todavía no existe, no se observa nada y la
 * altura se queda en cero para siempre. Un ref de callback se ejecuta cuando
 * el nodo entra en el árbol, que es justo cuando hay algo que medir.
 */
function useObservedBox<T extends HTMLElement>(alMedir: (el: T) => void) {
  const observer = useRef<ResizeObserver | null>(null)
  const guardado = useRef(alMedir)
  guardado.current = alMedir

  const ref = useCallback((node: T | null) => {
    observer.current?.disconnect()
    observer.current = null
    if (!node) return

    guardado.current(node)
    observer.current = new ResizeObserver(() => guardado.current(node))
    observer.current.observe(node)
  }, [])

  useEffect(() => () => observer.current?.disconnect(), [])

  return ref
}

/** Cuántas filas de altura fija caben en el hueco disponible. */
export function useFitRows<T extends HTMLElement = HTMLDivElement>(rowHeight: number, minimo = 1) {
  const [rows, setRows] = useState(minimo)

  const ref = useObservedBox<T>((el) => {
    // Se redondea hacia abajo: es preferible dejar unos píxeles libres al
    // final que cortar la última fila por la mitad, que es justo lo que hace
    // pensar que la lista continúa y que hay que desplazarse.
    setRows(Math.max(minimo, Math.floor(el.clientHeight / rowHeight)))
  })

  return [ref, rows] as const
}

/** Alto real de una caja, en píxeles. */
export function useBoxHeight<T extends HTMLElement = HTMLDivElement>() {
  const [alto, setAlto] = useState(0)
  const ref = useObservedBox<T>((el) => setAlto(el.clientHeight))
  return [ref, alto] as const
}

/**
 * Acota la página actual cuando la lista encoge.
 *
 * Sin esto, filtrar una lista estando en la página 4 deja la vista en blanco:
 * la página existe en el contador pero ya no tiene filas.
 */
export function paginar<T>(items: T[], page: number, size: number) {
  const pages = Math.max(1, Math.ceil(items.length / size))
  const actual = Math.min(page, pages - 1)
  return {
    pages,
    page: actual,
    slice: items.slice(actual * size, actual * size + size),
  }
}

/**
 * Reparte elementos de altura VARIABLE en páginas que quepan en `disponible`.
 *
 * Para listas cuyas filas no miden todas lo mismo —un día del libro de
 * fichajes ocupa lo que ocupen sus asientos—, dividir por una altura media no
 * sirve: se queda corta en los días largos y recorta el último, que es peor
 * que desplazarse, porque el contenido desaparece sin avisar.
 *
 * Se empaqueta de forma voraz: cada elemento entra en la página en curso
 * mientras quepa. Un elemento más alto que la caja entera ocupa su propia
 * página —recortarlo sería peor—, y ese es el único caso en que su panel
 * puede acabar desplazándose.
 */
export function paginarPorAltura<T>(
  items: T[],
  alto: (item: T) => number,
  disponible: number,
  page: number,
) {
  // Antes de la primera medición no se sabe qué cabe. Se devuelve una sola
  // página: en ese fotograma el contenedor aún no tiene altura, así que no hay
  // nada que recortar y el ajuste llega en el siguiente.
  if (disponible <= 0 || items.length === 0) {
    return { pages: 1, page: 0, slice: items }
  }

  const paginas: T[][] = []
  let actual: T[] = []
  let usado = 0

  for (const item of items) {
    const h = alto(item)
    if (actual.length > 0 && usado + h > disponible) {
      paginas.push(actual)
      actual = []
      usado = 0
    }
    actual.push(item)
    usado += h
  }
  if (actual.length > 0) paginas.push(actual)

  const indice = Math.min(page, paginas.length - 1)
  return { pages: paginas.length, page: indice, slice: paginas[indice] ?? [] }
}
