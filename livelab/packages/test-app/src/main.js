import './style.css';

const app = document.querySelector('#app');
const route = location.pathname;

const nav = `
  <nav aria-label="Test routes">
    <a href="/">Home</a>
    <a href="/console-error">Console error</a>
    <a href="/network-fail">Network fail</a>
    <a href="/exception">Exception</a>
    <a href="/broken">Broken layout</a>
  </nav>`;

function renderHome() {
  app.innerHTML = `
    <main>
      <h1 data-testid="app-title">LiveLab Test App</h1>
      ${nav}
      <section aria-label="Counter demo">
        <p>Interactive state check:</p>
        <button class="counter-button" data-testid="counter" aria-label="Increment counter">
          Count: <span data-testid="count-value">0</span>
        </button>
      </section>
      <section aria-label="Input demo">
        <label for="echo-input">Type something</label>
        <input id="echo-input" type="text" data-testid="echo-input" placeholder="Type here" />
        <p>You typed: <output data-testid="echo-output" for="echo-input"></output></p>
      </section>
    </main>`;
  let count = 0;
  const button = app.querySelector('[data-testid="counter"]');
  const value = app.querySelector('[data-testid="count-value"]');
  button.addEventListener('click', () => {
    count += 1;
    value.textContent = String(count);
    // Expose state for automation proof.
    window.__testAppState = { count };
  });
  const input = app.querySelector('[data-testid="echo-input"]');
  const outputEl = app.querySelector('[data-testid="echo-output"]');
  input.addEventListener('input', () => {
    outputEl.textContent = input.value;
    window.__testAppState = { ...(window.__testAppState || {}), text: input.value };
  });
}

function renderConsoleError() {
  app.innerHTML = `<main><h1>Console error route</h1>${nav}<p data-testid="route-marker">This route logs a console error on load.</p></main>`;
  console.error('LiveLab test-app: deliberate console error on /console-error');
}

function renderNetworkFail() {
  app.innerHTML = `<main><h1>Network fail route</h1>${nav}<p data-testid="route-marker">This route requests a missing resource.</p></main>`;
  fetch('/api/definitely-missing-endpoint').catch(() => {});
}

function renderException() {
  app.innerHTML = `<main><h1>Exception route</h1>${nav}<p data-testid="route-marker">This route throws an uncaught exception and an unhandled rejection.</p></main>`;
  Promise.reject(new Error('LiveLab test-app: deliberate unhandled rejection'));
  setTimeout(() => {
    throw new Error('LiveLab test-app: deliberate uncaught exception on /exception');
  }, 50);
}

function renderBroken() {
  app.innerHTML = `
    <main>
      <h1>Broken layout route</h1>
      ${nav}
      <div class="wide-overflow" aria-hidden="true"></div>
      <button class="counter-button" data-testid="covered-button" style="position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);">
        Primary action
      </button>
      <div class="blocking-banner">A fixed banner that covers the primary action</div>
    </main>`;
  console.error('LiveLab test-app: deliberate console error on /broken');
}

switch (route) {
  case '/console-error':
    renderConsoleError();
    break;
  case '/network-fail':
    renderNetworkFail();
    break;
  case '/exception':
    renderException();
    break;
  case '/broken':
    renderBroken();
    break;
  default:
    renderHome();
}
