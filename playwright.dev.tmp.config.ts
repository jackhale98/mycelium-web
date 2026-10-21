import base from './playwright.config';
export default { ...base, use: { ...base.use, baseURL: 'http://localhost:4400/mycelium-web/' }, webServer: undefined };
