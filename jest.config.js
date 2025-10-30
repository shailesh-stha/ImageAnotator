export default {
    transform: {
        '^.+\\.js$': 'babel-jest',
    },
    testEnvironment: 'jsdom',
    moduleNameMapper: {
        '../js/viewmodel.js': '<rootDir>/js/viewmodel.js',
        '../js/model.js': '<rootDir>/js/model.js',
        '../js/view.js': '<rootDir>/js/view.js',
        '../js/canvas-renderer.js': '<rootDir>/js/canvas-renderer.js',
    },
    testEnvironmentOptions: {
        "resources": "usable"
    },
};
