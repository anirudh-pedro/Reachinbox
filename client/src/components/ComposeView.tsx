import React, { useRef, useState } from 'react';
import {
  ArrowLeft,
  Paperclip,
  Clock,
  Send,
  Upload,
  X,
  Undo2,
  Redo2,
  Type,
  Bold,
  Italic,
  Underline,
  AlignLeft,
  ChevronsUpDown,
  ListOrdered,
  List,
  Indent,
  Outdent,
  Quote,
  AlignJustify,
  Strikethrough,
  AlertCircle,
  ChevronDown,
  Menu,
} from 'lucide-react';
import type { SenderAccount } from '../types';
import { api } from '../services/api';
import { SendLaterPopover } from './SendLaterPopover';

interface ComposeViewProps {
  senders: SenderAccount[];
  onClose: () => void;
  onScheduledSuccess: () => void;
  onOpenMobileNav: () => void;
}

interface Attachment {
  file: File;
  previewUrl?: string;
}

const TOOLBAR_ICONS = [
  Undo2,
  Redo2,
  Type,
  Bold,
  Italic,
  Underline,
  AlignLeft,
  ChevronsUpDown,
  ListOrdered,
  List,
  Indent,
  Outdent,
  Quote,
  AlignJustify,
  Strikethrough,
];

const VISIBLE_CHIP_LIMIT = 3;

function extractEmails(text: string): string[] {
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const matches = text.match(emailRegex) || [];
  return Array.from(new Set(matches));
}

export const ComposeView: React.FC<ComposeViewProps> = ({ senders, onClose, onScheduledSuccess, onOpenMobileNav }) => {
  const [senderId, setSenderId] = useState('');
  const [recipients, setRecipients] = useState<string[]>([]);
  const [recipientInput, setRecipientInput] = useState('');
  const [showAllChips, setShowAllChips] = useState(false);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [delayBetweenEmails, setDelayBetweenEmails] = useState('');
  const [hourlyLimit, setHourlyLimit] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [showSendLater, setShowSendLater] = useState(false);
  const [scheduledIso, setScheduledIso] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const csvInputRef = useRef<HTMLInputElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);

  const defaultFromEmail =
    senders.find((s) => s.id === senderId)?.email || senders[0]?.email || 'oliver.brown@domain.io';

  const addRecipients = (raw: string) => {
    const emails = extractEmails(raw);
    if (emails.length === 0) return;
    setRecipients((prev) => Array.from(new Set([...prev, ...emails])));
  };

  const handleRecipientKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
      e.preventDefault();
      addRecipients(recipientInput);
      setRecipientInput('');
    } else if (e.key === 'Backspace' && recipientInput === '' && recipients.length > 0) {
      setRecipients((prev) => prev.slice(0, -1));
    }
  };

  const handleRecipientBlur = () => {
    if (recipientInput.trim()) {
      addRecipients(recipientInput);
      setRecipientInput('');
    }
  };

  const removeRecipient = (email: string) => {
    setRecipients((prev) => prev.filter((r) => r !== email));
  };

  const handleCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      addRecipients(content);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleAttachmentUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const next: Attachment[] = files.map((file) => ({
      file,
      previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
    }));
    setAttachments((prev) => [...prev, ...next]);
    e.target.value = '';
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const validate = (): string | null => {
    if (recipients.length === 0) return 'Please add at least one recipient email address.';
    if (!subject.trim()) return 'Subject is required.';
    if (!body.trim()) return 'Email body cannot be empty.';
    return null;
  };

  const submit = async (isoOverride?: string | null) => {
    const validationError = validate();
    if (validationError) {
      setErrorMsg(validationError);
      return;
    }
    setErrorMsg('');
    setIsSubmitting(true);
    try {
      await api.scheduleEmails({
        recipients,
        subject,
        body,
        startTime: isoOverride ?? scheduledIso ?? undefined,
        delayBetweenEmails: delayBetweenEmails === '' ? undefined : Number(delayBetweenEmails),
        hourlyLimit: hourlyLimit === '' ? undefined : Number(hourlyLimit),
        senderId: senderId || undefined,
      });
      onScheduledSuccess();
    } catch (err: any) {
      setErrorMsg(err.response?.data?.message || err.message || 'Failed to schedule emails');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSendClick = () => {
    submit();
  };

  const handleSendLaterDone = (iso: string) => {
    setScheduledIso(iso);
    setShowSendLater(false);
    submit(iso);
  };

  const visibleChips = showAllChips ? recipients : recipients.slice(0, VISIBLE_CHIP_LIMIT);
  const hiddenCount = recipients.length - visibleChips.length;

  return (
    <div className="flex-1 flex flex-col min-h-screen bg-white">
      {/* Top bar */}
      <div className="flex items-center justify-between gap-2 px-3 sm:px-6 py-3 sm:py-4 border-b border-gray-100">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <button
            type="button"
            title="Open menu"
            onClick={onOpenMobileNav}
            className="p-2 -ml-1 rounded-lg text-gray-500 hover:bg-gray-50 transition-colors cursor-pointer md:hidden shrink-0"
          >
            <Menu className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-500 hover:text-gray-800 transition-colors cursor-pointer shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <h2 className="text-sm font-semibold text-gray-900 truncate">Compose New Email</h2>
        </div>

        <div className="flex items-center gap-3 sm:gap-4 shrink-0">
          <button
            type="button"
            onClick={() => attachmentInputRef.current?.click()}
            title="Attach files"
            className={`relative transition-colors cursor-pointer ${
              attachments.length > 0 ? 'text-emerald-500' : 'text-gray-400 hover:text-emerald-500'
            }`}
          >
            <Paperclip className="w-4 h-4" />
            {attachments.length > 0 && (
              <span className="absolute -top-1.5 -right-1.5 text-[9px] bg-emerald-500 text-white rounded-full w-3.5 h-3.5 flex items-center justify-center">
                {attachments.length}
              </span>
            )}
          </button>
          <input ref={attachmentInputRef} type="file" multiple className="hidden" onChange={handleAttachmentUpload} />

          <div className="relative">
            <button
              type="button"
              onClick={() => setShowSendLater((v) => !v)}
              title="Send later"
              className={`transition-colors cursor-pointer ${
                scheduledIso ? 'text-emerald-500' : 'text-gray-400 hover:text-emerald-500'
              }`}
            >
              <Clock className="w-4 h-4" />
            </button>
            {showSendLater && (
              <SendLaterPopover onCancel={() => setShowSendLater(false)} onDone={handleSendLaterDone} />
            )}
          </div>

          <button
            type="button"
            onClick={handleSendClick}
            disabled={isSubmitting}
            className="flex items-center gap-1.5 px-3 sm:px-4 py-1.5 rounded-full border border-emerald-500 text-emerald-600 text-xs font-semibold hover:bg-emerald-50 transition-colors disabled:opacity-50 cursor-pointer whitespace-nowrap"
          >
            {isSubmitting ? (
              <span className="w-3 h-3 border-2 border-emerald-300 border-t-emerald-600 rounded-full animate-spin" />
            ) : (
              <Send className="w-3 h-3" />
            )}
            <span>{scheduledIso ? 'Send Later' : 'Send'}</span>
          </button>
        </div>
      </div>

      {/* Form body */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-5 max-w-4xl w-full">
        {errorMsg && (
          <div className="mb-4 p-3 bg-red-50 border border-red-100 rounded-lg flex items-center gap-2 text-xs text-red-500">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* From */}
        <div className="flex items-center gap-3 sm:gap-4 py-2.5 border-b border-gray-100">
          <label className="text-xs text-gray-500 w-14 sm:w-28 shrink-0">From</label>
          <div className="relative flex-1 min-w-0">
            <select
              value={senderId}
              onChange={(e) => setSenderId(e.target.value)}
              className="w-full appearance-none bg-transparent text-sm text-gray-800 focus:outline-none cursor-pointer pr-6 truncate"
            >
              <option value="">{defaultFromEmail}</option>
              {senders.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.email}
                </option>
              ))}
            </select>
            <ChevronDown className="w-3.5 h-3.5 text-gray-400 absolute right-0 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>

        {/* To */}
        <div className="flex flex-wrap items-start gap-3 sm:gap-4 py-2.5 border-b border-gray-100">
          <label className="text-xs text-gray-500 w-14 sm:w-28 shrink-0 pt-1">To</label>
          <div className="flex-1 min-w-[140px] flex items-center flex-wrap gap-1.5">
            {visibleChips.map((email) => (
              <span
                key={email}
                className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 text-xs px-2 py-0.5 rounded-full"
              >
                {email}
                <button type="button" onClick={() => removeRecipient(email)} className="hover:text-emerald-900 cursor-pointer">
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
            {hiddenCount > 0 && !showAllChips && (
              <button
                type="button"
                onClick={() => setShowAllChips(true)}
                className="text-xs text-gray-500 px-1.5 py-0.5 rounded-full bg-gray-100 hover:bg-gray-200 cursor-pointer"
              >
                +{hiddenCount}
              </button>
            )}
            <input
              type="text"
              value={recipientInput}
              onChange={(e) => setRecipientInput(e.target.value)}
              onKeyDown={handleRecipientKeyDown}
              onBlur={handleRecipientBlur}
              placeholder={recipients.length === 0 ? 'recipient@example.com' : ''}
              className="flex-1 min-w-[140px] bg-transparent text-sm text-gray-800 placeholder-gray-400 focus:outline-none py-0.5"
            />
          </div>
          <button
            type="button"
            onClick={() => csvInputRef.current?.click()}
            className="flex items-center gap-1 text-xs font-medium text-emerald-600 hover:text-emerald-700 whitespace-nowrap cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Upload List</span>
          </button>
          <input ref={csvInputRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleCsvUpload} />
        </div>

        {/* Subject */}
        <div className="flex items-center gap-3 sm:gap-4 py-2.5 border-b border-gray-100">
          <label className="text-xs text-gray-500 w-14 sm:w-28 shrink-0">Subject</label>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject"
            className="flex-1 min-w-0 bg-transparent text-sm text-gray-800 placeholder-gray-400 focus:outline-none"
          />
        </div>

        {/* Delay / Hourly limit */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6 py-3">
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500 whitespace-nowrap">Delay between 2 emails</label>
            <input
              type="number"
              min="0"
              value={delayBetweenEmails}
              onChange={(e) => setDelayBetweenEmails(e.target.value)}
              placeholder="00"
              className="w-14 bg-gray-50 border border-gray-200 rounded-md px-2 py-1 text-xs text-gray-700 text-center focus:outline-none focus:border-emerald-400"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500 whitespace-nowrap">Hourly Limit</label>
            <input
              type="number"
              min="0"
              value={hourlyLimit}
              onChange={(e) => setHourlyLimit(e.target.value)}
              placeholder="00"
              className="w-14 bg-gray-50 border border-gray-200 rounded-md px-2 py-1 text-xs text-gray-700 text-center focus:outline-none focus:border-emerald-400"
            />
          </div>
        </div>

        {/* Editor */}
        <div className="bg-gray-50 rounded-xl overflow-hidden">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Type Your Reply..."
            rows={10}
            className="w-full bg-transparent px-4 pt-4 pb-2 text-sm text-gray-800 placeholder-gray-400 focus:outline-none resize-none"
          />

          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-3 px-4 pb-3">
              {attachments.map((att, i) => (
                <div key={i} className="relative w-24 h-24 rounded-lg overflow-hidden border border-gray-200 bg-white shrink-0">
                  {att.previewUrl ? (
                    <img src={att.previewUrl} alt={att.file.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-[10px] text-gray-400 p-2 text-center">
                      {att.file.name}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => removeAttachment(i)}
                    className="absolute top-1 right-1 bg-black/60 hover:bg-black/80 text-white rounded-full p-0.5 cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-3 gap-y-2 px-4 py-2.5 border-t border-gray-200/70 bg-white/60">
            {TOOLBAR_ICONS.map((Icon, i) => (
              <button
                key={i}
                type="button"
                className="text-gray-400 hover:text-gray-700 transition-colors cursor-pointer"
              >
                <Icon className="w-3.5 h-3.5" />
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
