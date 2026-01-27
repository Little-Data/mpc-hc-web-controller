// 深色模式主题管理
const ThemeManager = {
    // 存储键名
    STORAGE_KEY: 'mpcThemePreference',
    
    // 主题枚举
    Themes: {
        LIGHT: 'light',
        DARK: 'dark',
        AUTO: 'auto'
    },
    
    // 初始化
    init() {
        // 如果没有保存的主题设置，默认设置为自动
        if (!localStorage.getItem(this.STORAGE_KEY)) {
            this.setTheme(this.Themes.AUTO);
        }
        this.applyTheme();
        this.setupThemeToggle();
        this.watchSystemTheme();
    },
    
    // 获取系统主题
    getSystemTheme() {
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? this.Themes.DARK : this.Themes.LIGHT;
    },
    
    // 获取当前主题
    getCurrentTheme() {
        const saved = localStorage.getItem(this.STORAGE_KEY);
        if (saved === this.Themes.AUTO) {
            return this.getSystemTheme();
        }
        return saved || this.Themes.AUTO;
    },
    
    // 应用主题
    applyTheme(theme = null) {
        const themeToApply = theme || this.getCurrentTheme();
        const root = document.documentElement;
        
        if (themeToApply === this.Themes.DARK) {
            root.setAttribute('data-theme', 'dark');
        } else {
            root.removeAttribute('data-theme');
        }
        
        // 更新按钮文本
        this.updateThemeButtonText();
    },
    
    // 设置主题
    setTheme(theme) {
        if (!Object.values(this.Themes).includes(theme)) {
            console.warn('Invalid theme:', theme);
            return;
        }
        
        localStorage.setItem(this.STORAGE_KEY, theme);
        this.applyTheme(theme === this.Themes.AUTO ? null : theme);
    },
    
    // 设置主题切换按钮
    setupThemeToggle() {
        const themeBtn = document.getElementById('themeToggleBtn');
        if (!themeBtn) return;
        
        themeBtn.addEventListener('click', () => {
            const currentTheme = localStorage.getItem(this.STORAGE_KEY) || this.Themes.AUTO;
            let newTheme;
            
            switch (currentTheme) {
                case this.Themes.LIGHT:
                    newTheme = this.Themes.DARK;
                    break;
                case this.Themes.DARK:
                    newTheme = this.Themes.AUTO;
                    break;
                case this.Themes.AUTO:
                    newTheme = this.Themes.LIGHT;
                    break;
                default:
                    newTheme = this.Themes.AUTO;
            }
            
            this.setTheme(newTheme);
        });
    },
    
    // 更新按钮文本
    updateThemeButtonText() {
        const themeBtn = document.getElementById('themeToggleBtn');
        const indicator = document.getElementById('autoThemeIndicator');
        if (!themeBtn) return;
        
        const savedTheme = localStorage.getItem(this.STORAGE_KEY) || this.Themes.AUTO;
        const currentTheme = this.getCurrentTheme();
        
        let buttonText = '页面浅色/深色';
        let indicatorText = '';
        
        switch (savedTheme) {
            case this.Themes.LIGHT:
                buttonText = '☀️ 浅色模式';
                break;
            case this.Themes.DARK:
                buttonText = '🌙 深色模式';
                break;
            case this.Themes.AUTO:
                buttonText = '🔄 自动模式';
                indicatorText = currentTheme === this.Themes.DARK ? '(当前:深色)' : '(当前:浅色)';
                break;
            default:
                buttonText = '🔄 自动模式'; // 默认显示自动模式
                break;
        }
        
        themeBtn.textContent = buttonText;
        if (indicator) {
            indicator.textContent = indicatorText;
        }
    },
    
    // 监听系统主题变化
    watchSystemTheme() {
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        
        const handleChange = (e) => {
            const savedTheme = localStorage.getItem(this.STORAGE_KEY);
            if (savedTheme === this.Themes.AUTO) {
                this.applyTheme();
            }
        };
        
        // 现代浏览器
        if (mediaQuery.addEventListener) {
            mediaQuery.addEventListener('change', handleChange);
        } else if (mediaQuery.addListener) {
            // 旧版浏览器兼容
            mediaQuery.addListener(handleChange);
        }
    },
    
    // 清除主题设置（用于LocalStorage清理）
    clearThemeSetting() {
        localStorage.removeItem(this.STORAGE_KEY);
        this.applyTheme();
    }
};

// 初始化主题管理器
document.addEventListener('DOMContentLoaded', () => {
    ThemeManager.init();
});

// 导出供其他脚本使用
window.ThemeManager = ThemeManager;