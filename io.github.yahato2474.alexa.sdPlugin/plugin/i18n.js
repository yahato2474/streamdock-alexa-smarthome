// Texts drawn on keys. Stream Dock passes the UI language in the launch info.
const STRINGS = {
  en: {
    loginRequired: 'Log in',
    notSet: 'Not set',
    notFound: '(not found)',
    connectionError: 'Error',
    micOff: 'Mic OFF',
  },
  ja: {
    loginRequired: '要ログイン',
    notSet: '未設定',
    notFound: '(見つかりません)',
    connectionError: '接続エラー',
    micOff: 'マイクOFF',
  },
};

function strings(language) {
  const lang = String(language || 'en').slice(0, 2);
  return STRINGS[lang] || STRINGS.en;
}

module.exports = { strings };
