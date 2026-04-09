import { useEffect, useState } from 'react';

const KEY = 'zeit_dark_mode';

export function useDarkMode() {
  const [dark, setDark] = useState<boolean>(() => localStorage.getItem(KEY) === '1');

  useEffect(() => {
    if (dark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem(KEY, dark ? '1' : '0');
  }, [dark]);

  return { dark, setDark };
}
