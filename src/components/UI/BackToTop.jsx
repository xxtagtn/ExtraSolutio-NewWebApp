import { ArrowUp } from 'lucide-react';
import { useEffect, useState } from 'react';

const SHOW_AFTER_PX = 280;

export default function BackToTop({ raised = false }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let frame = null;

    const updateVisibility = () => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        setVisible(window.scrollY > SHOW_AFTER_PX);
      });
    };

    updateVisibility();
    window.addEventListener('scroll', updateVisibility, { passive: true });

    return () => {
      window.removeEventListener('scroll', updateVisibility);
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, []);

  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return (
    <button
      type="button"
      className={`back-to-top ${visible ? 'back-to-top--visible' : ''} ${raised ? 'back-to-top--raised' : ''}`.trim()}
      aria-label="Voltar ao topo"
      title="Voltar ao topo"
      aria-hidden={!visible}
      tabIndex={visible ? 0 : -1}
      onClick={scrollToTop}
    >
      <ArrowUp size={18} strokeWidth={2.2} aria-hidden="true" />
    </button>
  );
}
