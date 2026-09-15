// ==============================================================================
// '얼마내쏘' Supabase 및 앱 환경설정 (config.js)
// ==============================================================================
(function(window) {
  'use strict';

  const STORAGE_KEY = 'gyeongjosa_cloud_config';

  const defaultConfig = {
    supabaseUrl: '',      // 예: 'https://xyzcompany.supabase.co'
    supabaseAnonKey: '',  // 예: 'eyJhbGciOiJIUzI1NiIsInR5c...'
    autoSync: true,       // 로그인 시 자동 동기화
    realtimeEnabled: true // 실시간 부부 공유 감지
  };

  function loadConfig() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        return { ...defaultConfig, ...JSON.parse(saved) };
      }
    } catch (e) {
      console.warn('설정 로드 실패:', e);
    }
    return { ...defaultConfig };
  }

  function saveConfig(cfg) {
    try {
      const merged = { ...loadConfig(), ...cfg };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
      return true;
    } catch (e) {
      console.error('설정 저장 실패:', e);
      return false;
    }
  }

  function isConfigured() {
    const cfg = loadConfig();
    return !!(cfg.supabaseUrl && cfg.supabaseAnonKey);
  }

  window.AppConfig = {
    get: loadConfig,
    set: saveConfig,
    isConfigured: isConfigured
  };
})(window);
