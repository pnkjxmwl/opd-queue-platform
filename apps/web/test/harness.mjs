/**
 * A browser, minus the browser.
 *
 * Next renders every server action as an ordinary <form> carrying a hidden
 * `$ACTION_ID_<hash>` field and posting multipart/form-data back to the page it is
 * on. That is the progressive-enhancement path React ships for a client with no
 * JavaScript - and it means the whole console can be genuinely OPERATED over HTTP:
 * every button below is really pressed, not simulated by calling the API the button
 * would have called.
 *
 * ponytail: no browser, so this proves markup + server actions + API + database,
 * and nothing that needs a DOM - the camera, `<details>` opening, client-side
 * `required`. Those are the walkthrough a human still has to run. Upgrade path is
 * Playwright, and the case for it is that every defect in Phases 5 and 6 was found
 * by a person looking at a screen.
 */

const jar = new Map();

const cookieHeader = () =>
  [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');

function absorb(res) {
  for (const line of res.headers.getSetCookie?.() ?? []) {
    const [pair] = line.split(';');
    const eq = pair.indexOf('=');
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (value === '' || /Expires=Thu, 01 Jan 1970/i.test(line)) jar.delete(name);
    else jar.set(name, value);
  }
}

/** Follows redirects by hand so cookies set mid-chain (token refresh) are kept. */
export async function go(url, init = {}, depth = 0) {
  if (depth > 10) throw new Error(`redirect loop at ${url}`);
  const res = await fetch(url, {
    ...init,
    headers: { ...(init.headers ?? {}), cookie: cookieHeader() },
    redirect: 'manual',
  });
  absorb(res);

  if (res.status >= 300 && res.status < 400) {
    const location = new URL(res.headers.get('location'), url).toString();
    return go(location, { method: 'GET' }, depth + 1);
  }
  return { url, status: res.status, html: await res.text() };
}

export async function login(web, email, password) {
  const res = await fetch(`${web}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
    redirect: 'manual',
  });
  absorb(res);
  if (!res.ok) throw new Error(`login failed for ${email}: ${res.status}`);
}

export const logout = () => jar.clear();

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

const stripTags = (s) => s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

const attr = (tag, name) => {
  const m = tag.match(new RegExp('\\b' + name + '="([^"]*)"'));
  return m ? m[1] : undefined;
};

/** Every <form> on the page, with its fields and the label of its submit button. */
export function parseForms(html) {
  const forms = [];
  for (const m of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g)) {
    const [, openAttrs, body] = m;
    const fields = {};

    for (const input of body.matchAll(/<input\b[^>]*>/g)) {
      const name = attr(input[0], 'name');
      if (!name) continue;
      const type = attr(input[0], 'type');
      // An unchecked radio contributes nothing, exactly as a browser would send it.
      if ((type === 'radio' || type === 'checkbox') && !/\bchecked\b/.test(input[0])) continue;
      fields[name] = attr(input[0], 'value') ?? '';
    }

    for (const select of body.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/g)) {
      const name = attr(select[1], 'name');
      if (!name) continue;
      const selected = select[2].match(/<option\b[^>]*\bselected\b[^>]*>/);
      const first = select[2].match(/<option\b[^>]*>/);
      fields[name] = attr(selected?.[0] ?? first?.[0] ?? '', 'value') ?? '';
    }

    const buttons = [...body.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map((b) => ({
      label: stripTags(b[2]),
      // The ATTRIBUTE, not the word: `disabled:bg-ink-disabled` is a Tailwind
      // variant sitting in the class list of every button, disabled or not.
      disabled: /\sdisabled(=|\s|$)/.test(b[1]),
    }));

    forms.push({
      action: attr(openAttrs, 'action') ?? '',
      fields,
      button: buttons[0]?.label ?? '',
      disabled: buttons[0]?.disabled ?? false,
      body,
    });
  }
  return forms;
}

/**
 * Press a button.
 *
 * `button` matches the visible label, `where` narrows to the form carrying those
 * field values (which is how one row's button is told from another's), and `fill`
 * types into the inputs before submitting.
 */
export async function press(page, { button, where = {}, fill = {} }) {
  const forms = parseForms(page.html).filter((f) => {
    if (button && !f.button.toLowerCase().includes(button.toLowerCase())) return false;
    return Object.entries(where).every(([k, v]) => f.fields[k] === v);
  });

  if (forms.length === 0) {
    throw new Error(
      `no form with button "${button}" ${JSON.stringify(where)} on ${page.url}\n` +
        `buttons present: ${parseForms(page.html).map((f) => f.button).join(' | ')}`,
    );
  }

  const form = forms[0];
  const data = new FormData();
  for (const [k, v] of Object.entries({ ...form.fields, ...fill })) data.append(k, v);

  const action = form.action === '' ? page.url : new URL(form.action, page.url).toString();
  return go(action, { method: 'POST', body: data });
}

/** True when a button with this label exists and is not disabled. */
export const canPress = (page, button, where = {}) =>
  parseForms(page.html).some(
    (f) =>
      f.button.toLowerCase().includes(button.toLowerCase()) &&
      !f.disabled &&
      Object.entries(where).every(([k, v]) => f.fields[k] === v),
  );

// ---------------------------------------------------------------------------
// Reading the page
// ---------------------------------------------------------------------------

/** The page as a person reads it: tags gone, whitespace collapsed. */
export const visible = (page) =>
  stripTags(page.html.replace(/<script[\s\S]*?<\/script>/g, ''));

/** The text of one card, e.g. section(page, 'Now with'). */
export function section(page, title) {
  const text = visible(page);
  const start = text.indexOf(title);
  return start === -1 ? '' : text.slice(start, start + 900);
}
