import { useLayoutEffect, useRef } from "react";

/** Below this the chat stops shrinking; the room is unusable any smaller. */
const MIN_HEIGHT_PX = 320;

/**
 * Sizes an element to exactly fill the viewport below the site chrome, and
 * stops the document from scrolling while it is mounted.
 *
 * The chrome above the chat is not a fixed height: the live-now banner appears
 * asynchronously and wraps on narrow screens, and the ticker is optional. So the
 * offset is measured rather than computed from CSS variables, and re-measured
 * whenever anything above the element changes size.
 */
export function useFillViewport<T extends HTMLElement>() {
  const ref = useRef<T>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    const root = document.documentElement;
    const previousOverflow = root.style.overflow;
    window.scrollTo(0, 0);
    // The chat route renders without the footer, so the document is exactly one
    // viewport tall. This catches rounding and keeps wheel momentum off the page.
    root.style.overflow = "hidden";

    let applied = -1;
    const measure = () => {
      const viewport = window.visualViewport?.height ?? window.innerHeight;
      const top = element.getBoundingClientRect().top + window.scrollY;
      const height = Math.max(MIN_HEIGHT_PX, Math.floor(viewport - top));
      if (height === applied) return;
      applied = height;
      element.style.height = `${height}px`;
    };

    measure();

    // Everything laid out before <main>: header, live banner, ticker.
    const main = element.closest("main");
    const observer = new ResizeObserver(measure);
    const observeChrome = () => {
      for (
        let sibling = main?.previousElementSibling;
        sibling;
        sibling = sibling.previousElementSibling
      ) {
        observer.observe(sibling);
      }
      // Content inside <main> above the element, such as the page heading.
      for (let node: Element | null = element; node && node !== main; node = node.parentElement) {
        for (
          let sibling = node.previousElementSibling;
          sibling;
          sibling = sibling.previousElementSibling
        ) {
          observer.observe(sibling);
        }
      }
    };
    observeChrome();

    // The live banner mounts after the first paint. A ResizeObserver never sees
    // an element that did not exist yet, so watch for chrome being added or removed.
    const mutations = new MutationObserver(() => {
      observer.disconnect();
      observeChrome();
      measure();
    });
    if (main?.parentElement) mutations.observe(main.parentElement, { childList: true });

    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);

    return () => {
      mutations.disconnect();
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
      root.style.overflow = previousOverflow;
      element.style.height = "";
    };
  }, []);

  return ref;
}
