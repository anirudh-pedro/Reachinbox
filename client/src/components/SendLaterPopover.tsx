import React, { useState } from 'react';
import { Calendar } from 'lucide-react';

interface SendLaterPopoverProps {
  onCancel: () => void;
  onDone: (isoDate: string) => void;
}

const PRESETS = [
  { label: 'Tomorrow', hour: 9 },
  { label: 'Tomorrow, 10:00 AM', hour: 10 },
  { label: 'Tomorrow, 11:00 AM', hour: 11 },
  { label: 'Tomorrow, 3:00 PM', hour: 15 },
];

export const SendLaterPopover: React.FC<SendLaterPopoverProps> = ({ onCancel, onDone }) => {
  const [customDate, setCustomDate] = useState('');
  const [selectedIso, setSelectedIso] = useState<string>('');

  const handlePresetClick = (hour: number) => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(hour, 0, 0, 0);
    setSelectedIso(tomorrow.toISOString());
    setCustomDate('');
  };

  const handleDone = () => {
    if (customDate) {
      onDone(new Date(customDate).toISOString());
    } else if (selectedIso) {
      onDone(selectedIso);
    } else {
      onCancel();
    }
  };

  return (
    <div
      className="fixed left-1/2 -translate-x-1/2 top-20 sm:absolute sm:left-auto sm:translate-x-0 sm:right-0 sm:top-full sm:mt-2
        w-72 max-w-[calc(100vw-2rem)] bg-white border border-gray-200 rounded-xl shadow-lg z-30 animate-fade-in-scale overflow-hidden"
    >
      <div className="px-4 py-3 border-b border-gray-100">
        <p className="text-xs font-semibold text-gray-700 mb-2">Send Later</p>
        <div className="relative">
          <input
            type="datetime-local"
            value={customDate}
            onChange={(e) => {
              setCustomDate(e.target.value);
              setSelectedIso('');
            }}
            placeholder="Pick date & time"
            className="w-full bg-gray-50 border border-gray-200 rounded-lg pl-3 pr-8 py-1.5 text-xs text-gray-700 focus:outline-none focus:border-emerald-400"
          />
          <Calendar className="w-3.5 h-3.5 text-gray-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>
      </div>

      <div className="py-1">
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            onClick={() => handlePresetClick(preset.hour)}
            className="w-full text-left px-4 py-2 text-xs text-gray-600 hover:bg-gray-50 transition-colors cursor-pointer"
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-gray-100">
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 rounded-lg text-xs font-medium text-gray-500 hover:bg-gray-50 transition-colors cursor-pointer"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleDone}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-emerald-500 hover:bg-emerald-600 transition-colors cursor-pointer"
        >
          Done
        </button>
      </div>
    </div>
  );
};
