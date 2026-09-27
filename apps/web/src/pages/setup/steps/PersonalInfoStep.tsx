import { useState } from 'react';
import type { SettingsFormApi } from '../../../lib/use-settings-form';
import { Button, Input } from '../../../components/ui';

interface Entry {
  id: number;
  key: string;
  value: string;
}

let nextId = 0;

function toEntries(map: Record<string, string>): Entry[] {
  const entries = Object.entries(map).map(([key, value]) => ({ id: nextId++, key, value }));
  // Seed a "name" row by default (matching koris.example.json's
  // personal_information shape) so the field is ready to fill in rather
  // than requiring the user to add it manually.
  return entries.length > 0 ? entries : [{ id: nextId++, key: 'name', value: '' }];
}

export function PersonalInfoStep({ api }: { api: SettingsFormApi }) {
  // Rows are kept as a locally-owned, id-stable list rather than derived fresh
  // from `personal_information` on every render — deriving from the object
  // directly breaks when two rows share a (possibly still-blank) key, since
  // Object.fromEntries silently collapses duplicate keys.
  const [entries, setEntries] = useState<Entry[]>(() => toEntries(api.form.personal_information));

  function sync(next: Entry[]) {
    setEntries(next);
    const map: Record<string, string> = {};
    for (const entry of next) {
      if (entry.key.trim() && entry.value.trim()) map[entry.key] = entry.value;
    }
    api.update((prev) => ({ ...prev, personal_information: map }));
  }

  function updateEntry(id: number, field: 'key' | 'value', value: string) {
    sync(entries.map((entry) => (entry.id === id ? { ...entry, [field]: value } : entry)));
  }

  function removeEntry(id: number) {
    sync(entries.filter((entry) => entry.id !== id));
  }

  function addEntry() {
    sync([...entries, { id: nextId++, key: '', value: '' }]);
  }

  return (
    <div>
      <p className="mb-4 text-caption leading-relaxed text-txt-2">
        Optional context the assistant can use about you — name, location, preferences. Leave it empty
        if you'd rather not say.
      </p>
      <div className="space-y-3 sm:space-y-2">
        {entries.map((entry) => (
          <div
            key={entry.id}
            className="flex flex-col gap-2 rounded-panel border border-subtle bg-bg-3/40 p-2.5 sm:flex-row sm:items-center sm:border-0 sm:bg-transparent sm:p-0"
          >
            <div className="flex flex-1 flex-col gap-2 sm:flex-row">
              <Input
                value={entry.key}
                onChange={(e) => updateEntry(entry.id, 'key', e.target.value)}
                placeholder="key"
                aria-label="Field name"
                className="w-full sm:w-1/3"
              />
              <Input
                value={entry.value}
                onChange={(e) => updateEntry(entry.id, 'value', e.target.value)}
                placeholder={entry.key.trim().toLowerCase() === 'name' ? 'e.g. John Doe' : 'value'}
                aria-label="Field value"
                className="w-full sm:flex-1"
              />
            </div>
            <Button
              variant="ghost"
              onClick={() => removeEntry(entry.id)}
              aria-label={entry.key.trim() ? `Remove ${entry.key}` : 'Remove field'}
              className="w-full hover:text-danger sm:w-auto"
            >
              Remove
            </Button>
          </div>
        ))}
      </div>
      <Button onClick={addEntry} className="mt-4 w-full sm:w-auto">
        Add field
      </Button>
    </div>
  );
}
