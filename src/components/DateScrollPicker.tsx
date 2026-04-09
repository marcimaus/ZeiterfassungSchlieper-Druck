import { useRef, useEffect, useState } from 'react';

const ITEM_H = 44;

const MONTHS_DE = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

interface ColumnProps {
  items: string[];
  selectedIndex: number;
  onSelect: (idx: number) => void;
  width?: number;
  visibleItems?: number;
}

function ScrollColumn({ items, selectedIndex, onSelect, width = 80, visibleItems = 5 }: ColumnProps) {
  const pad = ITEM_H * Math.floor(visibleItems / 2);
  const ref = useRef<HTMLDivElement>(null);
  const [displayIdx, setDisplayIdx] = useState(selectedIndex);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const userScrolling = useRef(false);

  // Sync prop → scroll position when not user-driven
  useEffect(() => {
    if (!ref.current || userScrolling.current) return;
    ref.current.scrollTop = selectedIndex * ITEM_H;
    setDisplayIdx(selectedIndex);
  }, [selectedIndex]);

  function handleScroll() {
    if (!ref.current) return;
    userScrolling.current = true;
    const raw = ref.current.scrollTop / ITEM_H;
    const idx = Math.max(0, Math.min(items.length - 1, Math.round(raw)));
    setDisplayIdx(idx);

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      userScrolling.current = false;
      if (ref.current) ref.current.scrollTop = idx * ITEM_H;
      onSelect(idx);
    }, 180);
  }

  return (
    <div style={{ position: 'relative', width, flexShrink: 0 }}>
      {/* selection highlight band */}
      <div style={{
        position: 'absolute',
        top: pad,
        left: 0, right: 0,
        height: ITEM_H,
        background: 'var(--bg-secondary, #eef0fa)',
        borderRadius: 10,
        pointerEvents: 'none',
        zIndex: 1,
      }} />

      <div
        ref={ref}
        onScroll={handleScroll}
        style={{
          height: ITEM_H * visibleItems,
          overflowY: 'scroll',
          scrollSnapType: 'y mandatory',
          scrollbarWidth: 'none',
          WebkitOverflowScrolling: 'touch' as never,
          position: 'relative',
          zIndex: 2,
        }}
      >
        {/* hide scrollbar in webkit */}
        <style>{`.scroll-col-${width}::-webkit-scrollbar { display: none; }`}</style>
        <div style={{ height: pad }} />
        {items.map((label, i) => {
          const dist = Math.abs(i - displayIdx);
          return (
            <div
              key={i}
              style={{
                height: ITEM_H,
                scrollSnapAlign: 'center',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: dist === 0 ? 17 : dist === 1 ? 14 : 12,
                fontWeight: dist === 0 ? 700 : 400,
                color: dist === 0
                  ? 'var(--text-primary, #1e2a3b)'
                  : dist === 1
                  ? 'var(--text-secondary, #6b7280)'
                  : 'var(--border, #d1d5db)',
                userSelect: 'none',
                transition: 'font-size 0.1s, color 0.1s',
              }}
            >
              {label}
            </div>
          );
        })}
        <div style={{ height: pad }} />
      </div>

      {/* fade gradients top/bottom */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: pad,
        background: 'linear-gradient(to bottom, var(--bg-card, #fff) 30%, transparent)',
        pointerEvents: 'none', zIndex: 3,
      }} />
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, height: pad,
        background: 'linear-gradient(to top, var(--bg-card, #fff) 30%, transparent)',
        pointerEvents: 'none', zIndex: 3,
      }} />
    </div>
  );
}

interface TimeScrollPickerProps {
  value: string; // "HH:MM" or ""
  onChange: (value: string) => void;
  visibleItems?: number;
}

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));

export function TimeScrollPicker({ value, onChange, visibleItems = 5 }: TimeScrollPickerProps) {
  const parsed = value.match(/^(\d{2}):(\d{2})$/);
  const [hour, setHour] = useState(parsed ? parseInt(parsed[1]) : 8);
  const [minute, setMinute] = useState(parsed ? parseInt(parsed[2]) : 0);

  function emit(h: number, m: number) {
    onChange(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
  }

  function handleHour(idx: number) {
    setHour(idx);
    emit(idx, minute);
  }

  function handleMinute(idx: number) {
    setMinute(idx);
    emit(hour, idx);
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 4, overflow: 'hidden' }}>
      <ScrollColumn items={HOURS} selectedIndex={hour} onSelect={handleHour} width={60} visibleItems={visibleItems} />
      <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', paddingBottom: 2 }}>:</div>
      <ScrollColumn items={MINUTES} selectedIndex={minute} onSelect={handleMinute} width={60} visibleItems={visibleItems} />
    </div>
  );
}

interface DateScrollPickerProps {
  value: string; // "YYYY-MM-DD" or ""
  onChange: (value: string) => void;
  maxDate?: string; // "YYYY-MM-DD" – no date beyond this is selectable
  visibleItems?: number;
}

const currentYear = new Date().getFullYear();
const ALL_YEARS = Array.from({ length: currentYear - 1939 }, (_, i) => String(1940 + i));

export default function DateScrollPicker({ value, onChange, maxDate, visibleItems = 5 }: DateScrollPickerProps) {
  // Parse current value
  const parsed = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const initYear = parsed ? parseInt(parsed[1]) : 1990;
  const initMonth = parsed ? parseInt(parsed[2]) - 1 : 0;
  const initDay = parsed ? parseInt(parsed[3]) : 1;

  const [year, setYear] = useState(initYear);
  const [month, setMonth] = useState(initMonth);
  const [day, setDay] = useState(initDay);

  // Compute limits from maxDate
  const maxParsed = maxDate?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const maxYear  = maxParsed ? parseInt(maxParsed[1]) : null;
  const maxMonth = maxParsed ? parseInt(maxParsed[2]) - 1 : null; // 0-based
  const maxDay0  = maxParsed ? parseInt(maxParsed[3]) : null;

  const YEARS = maxYear != null ? ALL_YEARS.filter(y => parseInt(y) <= maxYear) : ALL_YEARS;

  const monthCount = (maxYear != null && year === maxYear && maxMonth != null)
    ? maxMonth + 1
    : 12;
  const months = MONTHS_DE.slice(0, monthCount);

  const dayLimit = (maxYear != null && year === maxYear && maxMonth != null && month === maxMonth && maxDay0 != null)
    ? maxDay0
    : daysInMonth(year, month);
  const days = Array.from({ length: dayLimit }, (_, i) => String(i + 1).padStart(2, '0'));

  const yearIdx = YEARS.indexOf(String(year));

  function emit(d: number, m: number, y: number) {
    const dd = String(Math.min(d, daysInMonth(y, m))).padStart(2, '0');
    const mm = String(m + 1).padStart(2, '0');
    onChange(`${y}-${mm}-${dd}`);
  }

  function handleDay(idx: number) {
    const d = idx + 1;
    setDay(d);
    emit(d, month, year);
  }

  function handleMonth(idx: number) {
    setMonth(idx);
    const limit = (maxYear != null && year === maxYear && maxMonth != null && idx === maxMonth && maxDay0 != null)
      ? maxDay0 : daysInMonth(year, idx);
    const clamped = Math.min(day, limit);
    setDay(clamped);
    emit(clamped, idx, year);
  }

  function handleYear(idx: number) {
    const y = parseInt(YEARS[idx]);
    setYear(y);
    const clampedMonth = (maxYear != null && y === maxYear && maxMonth != null)
      ? Math.min(month, maxMonth) : month;
    const limit = (maxYear != null && y === maxYear && maxMonth != null && clampedMonth === maxMonth && maxDay0 != null)
      ? maxDay0 : daysInMonth(y, clampedMonth);
    const clampedDay = Math.min(day, limit);
    setMonth(clampedMonth);
    setDay(clampedDay);
    emit(clampedDay, clampedMonth, y);
  }

  return (
    <div style={{
      display: 'flex',
      justifyContent: 'center',
      gap: 8,
      overflow: 'hidden',
    }}>
      <ScrollColumn items={days} selectedIndex={Math.min(day - 1, dayLimit - 1)} onSelect={handleDay} width={52} visibleItems={visibleItems} />
      <ScrollColumn items={months} selectedIndex={month} onSelect={handleMonth} width={110} visibleItems={visibleItems} />
      <ScrollColumn items={YEARS} selectedIndex={Math.max(0, yearIdx)} onSelect={handleYear} width={68} visibleItems={visibleItems} />
    </div>
  );
}
