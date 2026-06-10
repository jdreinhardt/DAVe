import { useState } from 'react';

export default function TagInput({
  value,
  onChange,
}: {
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const [input, setInput] = useState('');

  const add = (raw: string) => {
    const tag = raw.trim();
    if (tag && !value.includes(tag)) onChange([...value, tag]);
    setInput('');
  };

  return (
    <div className="rounded-md border border-input bg-background px-2.5 py-1.5 min-h-[2.5rem]">
      <div className="flex flex-wrap gap-1 mb-1">
        {value.map((tag) => (
          <span
            key={tag}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs bg-muted text-muted-foreground"
          >
            {tag}
            <button
              type="button"
              onClick={() => onChange(value.filter((t) => t !== tag))}
              className="hover:text-foreground leading-none"
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            add(input);
          }
          if (e.key === 'Backspace' && !input && value.length > 0) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={() => {
          if (input.trim()) add(input);
        }}
        placeholder="Type and press Enter…"
        className="w-full text-sm bg-transparent outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}
