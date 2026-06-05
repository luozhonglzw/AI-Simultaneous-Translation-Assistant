/**
 * 源语言选择组件
 * 切换语言时触发新会话
 */

interface LanguageSelectorProps {
  value: string;
  onChange: (lang: string) => void;
  isRecording?: boolean;
}

const languages = [
  { code: 'en', label: 'English', flag: '🇺🇸' },
  { code: 'ja', label: '日本語', flag: '🇯🇵' },
  { code: 'ko', label: '한국어', flag: '🇰🇷' },
  { code: 'fr', label: 'Français', flag: '🇫🇷' },
  { code: 'de', label: 'Deutsch', flag: '🇩🇪' },
];

export function LanguageSelector({ value, onChange, isRecording }: LanguageSelectorProps) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-slate-400">源语言：</span>
      <div className="flex gap-1">
        {languages.map((lang) => (
          <button
            key={lang.code}
            onClick={() => {
              if (lang.code === value) return;
              onChange(lang.code);
            }}
            className={`
              px-3 py-1.5 rounded-lg text-sm transition-all
              ${
                value === lang.code
                  ? 'bg-white/20 text-white border border-white/30'
                  : 'bg-white/5 text-slate-400 hover:bg-white/10 border border-transparent'
              }
              ${isRecording && value !== lang.code ? 'ring-1 ring-amber-500/50' : ''}
            `}
            title={isRecording && value !== lang.code ? '切换语言将自动结束当前会话并开始新会话' : lang.label}
          >
            {lang.flag} {lang.label}
          </button>
        ))}
      </div>
      {isRecording && (
        <span className="text-[10px] text-amber-400">切换语言将新开会话</span>
      )}
    </div>
  );
}
