import { DndContext, DragEndEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Player, TeamId } from '@chicken-vault/shared';

interface PlayerSeatEditorProps {
  players: Player[];
  onReorder: (playerIds: string[]) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
  onTeamChange: (id: string, team: TeamId) => Promise<void>;
}

interface SortablePlayerRowProps {
  player: Player;
  onRemove: (id: string) => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
  onTeamChange: (id: string, team: TeamId) => Promise<void>;
}

function SortablePlayerRow({ player, onRemove, onRename, onTeamChange }: SortablePlayerRowProps): JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: player.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition
  };

  return (
    <li ref={setNodeRef} style={style} className="player-row">
      <button className="drag-handle" type="button" {...attributes} {...listeners}>
        ≡
      </button>
      <span className="seat-pill">{player.seatIndex + 1}</span>
      <input
        value={player.name}
        onChange={(event) => {
          void onRename(player.id, event.target.value);
        }}
      />
      <select
        value={player.team}
        onChange={(event) => {
          void onTeamChange(player.id, event.target.value as TeamId);
        }}
      >
        <option value="A">Team A</option>
        <option value="B">Team B</option>
      </select>
      <button
        className="danger"
        type="button"
        onClick={() => {
          void onRemove(player.id);
        }}
      >
        Remove
      </button>
    </li>
  );
}

export function PlayerSeatEditor({
  players,
  onReorder,
  onRemove,
  onRename,
  onTeamChange
}: PlayerSeatEditorProps): JSX.Element {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const sorted = [...players].sort((a, b) => a.seatIndex - b.seatIndex);

  const handleDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }

    const oldIndex = sorted.findIndex((player) => player.id === active.id);
    const newIndex = sorted.findIndex((player) => player.id === over.id);

    if (oldIndex < 0 || newIndex < 0) {
      return;
    }

    const reordered = arrayMove(sorted, oldIndex, newIndex).map((player) => player.id);
    void onReorder(reordered);
  };

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <SortableContext items={sorted.map((player) => player.id)} strategy={verticalListSortingStrategy}>
        <ul className="player-list">
          {sorted.map((player) => (
            <SortablePlayerRow
              key={player.id}
              player={player}
              onRemove={onRemove}
              onRename={onRename}
              onTeamChange={onTeamChange}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}
