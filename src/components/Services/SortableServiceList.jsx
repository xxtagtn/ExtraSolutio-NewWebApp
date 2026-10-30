import { useState } from 'react';
import { ArrowDown, ArrowUp, ChevronsUp, GripVertical, MoreHorizontal } from 'lucide-react';
import { closestCenter, DndContext, KeyboardSensor, MouseSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

function SortableRow({ row, enabled, busy, destination, onMove, rows, children }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: row.id, disabled: !enabled || busy });
  const index = rows.findIndex((item) => item.id === row.id);
  function move(event, target) {
    event.currentTarget.closest('details').open = false;
    if (target) onMove(row.id, target.id);
  }
  return <div ref={setNodeRef} className={`service-sortable-row${enabled ? ' service-sortable-row--manual' : ''}${isDragging ? ' service-sortable-row--dragging' : ''}`}
    data-event-id={row.id} data-drop={destination} style={{ transform: CSS.Transform.toString(transform), transition }}>
    {enabled && <button type="button" ref={setActivatorNodeRef} className="service-drag-handle" {...attributes} {...listeners}
      aria-disabled={busy} aria-label={`Reordenar ${row.name}`} title="Arrastar para reordenar"><GripVertical size={14} aria-hidden="true" /></button>}
    {children}
    {enabled && <details name="service-order-options" className="service-order-menu" onKeyDown={(event) => {
      if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary').focus(); }
    }}>
      <summary aria-label={`Opções de ordem de ${row.name}`} title="Opções de ordem"><MoreHorizontal size={16} aria-hidden="true" /></summary>
      <div>
        <button type="button" disabled={busy || index === 0} onClick={(event) => move(event, rows[0])}><ChevronsUp size={15} />Mover para o topo</button>
        <button type="button" disabled={busy || index === 0} onClick={(event) => move(event, rows[index - 1])}><ArrowUp size={15} />Mover para cima</button>
        <button type="button" disabled={busy || index === rows.length - 1} onClick={(event) => move(event, rows[index + 1])}><ArrowDown size={15} />Mover para baixo</button>
      </div>
    </details>}
  </div>;
}

export default function SortableServiceList({ rows, enabled, busy, onMove, renderRow }) {
  const [active, setActive] = useState(null), [over, setOver] = useState(null);
  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const index = (id) => rows.findIndex((row) => row.id === id);
  const name = (id) => rows.find((row) => row.id === id)?.name || 'Evento';
  const reset = () => { setActive(null); setOver(null); };
  return <DndContext sensors={sensors} collisionDetection={closestCenter}
    accessibility={{ screenReaderInstructions: { draggable: 'Prime espaço para agarrar, usa as setas para mover, espaço para guardar ou Escape para cancelar.' },
      announcements: {
        onDragStart: ({ active }) => `${name(active.id)} selecionado para reordenar.`,
        onDragOver: ({ over }) => over ? `Posição ${index(over.id) + 1} de ${rows.length}.` : undefined,
        onDragEnd: ({ active, over }) => over ? `${name(active.id)} colocado na posição ${index(over.id) + 1}.` : 'Ordenação cancelada.',
        onDragCancel: () => 'Ordenação cancelada.',
      } }}
    onDragStart={({ active }) => setActive(active.id)} onDragOver={({ over }) => setOver(over?.id ?? null)}
    onDragCancel={reset} onDragEnd={({ active, over }) => { reset(); if (over) onMove(active.id, over.id); }}>
    <SortableContext items={rows.map((row) => row.id)} strategy={verticalListSortingStrategy}>
      <div className="service-card-list">
        {rows.map((row) => <SortableRow key={row.id} row={row} enabled={enabled} busy={busy} rows={rows} onMove={onMove}
          destination={active !== null && over === row.id && active !== over ? (index(active) < index(over) ? 'after' : 'before') : undefined}>
          {renderRow(row)}
        </SortableRow>)}
      </div>
    </SortableContext>
  </DndContext>;
}
