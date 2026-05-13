/* Iter 152 — Call Menu dialplan generator.
 *
 * Builds a single FreeSWITCH <extension> XML block from a call_menu
 * row + its options. Pure function — no I/O. Easy to unit test.
 *
 * The extension name is `call_menu_<id>` so other dialplan branches
 * (DIDs, in-group overflow, campaign no-agent drop in iter 153)
 * can hop in via `execute_extension call_menu_<id> XML default`.
 *
 * Structure:
 *   - First condition: matches destination_number, plays prompt,
 *     collects the digit into channel var menu_digit.
 *   - One condition per option: matches the digit (and TOD window
 *     if set), runs the action. break="on-true" stops further
 *     condition checks once a match fires.
 *   - Final condition: catch-all default action when no option
 *     matched. Runs only if every prior `break="on-true"` missed.
 *
 * The DTMF log event (call_menu_log table) is emitted via
 * `event Event-Subclass=dialeros::menu_press` from each option
 * branch and from the timeout/invalid paths. fs-events.ts in
 * iter 153 subscribes to that class and inserts the row.
 */
import type {
  CallMenuOptionRecord,
  CallMenuRecord,
} from './db';

export interface DialplanInputs {
  menu: Pick<
    CallMenuRecord,
    | 'id'
    | 'name'
    | 'prompt_path'
    | 'prompt_tts_text'
    | 'timeout_seconds'
    | 'max_retries'
    | 'invalid_audio_path'
    | 'timeout_audio_path'
    | 'default_action_type'
    | 'default_action_value'
  >;
  options: CallMenuOptionRecord[];
  /** Default carrier gateway for action_type=did. Iter 153 will read
   * this from settings; iter 152 hardcodes a placeholder so the .xml
   * is self-contained. */
  defaultGateway?: string;
}

/** XML-escape attribute or text content. The data attribute on
 * <action> can contain almost anything; quotes and < > & must be
 * encoded so they don't break the XML parser. */
function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Map an action_type + value to one or more <action> elements.
 * Returns just the inner XML (no <condition> wrapper) so callers
 * can compose it under different conditions. */
function actionXml(
  actionType: string,
  actionValue: string | null,
  dispoCode: string | null,
  menu: DialplanInputs['menu'],
  defaultGateway: string,
): string {
  const lines: string[] = [];
  // Always log the press event for analytics.
  lines.push(
    '      <action application="event" data="Event-Subclass=dialeros::menu_press,Event-Name=CUSTOM,' +
      `dialeros_menu_id=${xmlEscape(menu.id)},dialeros_menu_digit=\${menu_digit},` +
      `dialeros_menu_action=${xmlEscape(actionType)}"/>`,
  );
  // Per-option disposition override — stamped on the dial_intent
  // via channel var so the fs-events listener can pick it up at
  // hangup time.
  if (dispoCode && dispoCode.trim()) {
    lines.push(
      `      <action application="set" data="dialeros_menu_dispo=${xmlEscape(dispoCode.trim())}"/>`,
    );
  }
  const val = (actionValue ?? '').trim();
  switch (actionType) {
    case 'hangup':
      lines.push('      <action application="hangup"/>');
      break;
    case 'voicemail':
      if (val) {
        lines.push(
          `      <action application="playback" data="${xmlEscape(val)}"/>`,
        );
      }
      lines.push('      <action application="hangup"/>');
      break;
    case 'in_group':
      // Convention from iter 153: in-group extension is named
      // `in_group_<id>`. If the value is already a full destination
      // (contains a space or "XML"), pass it through; otherwise
      // wrap it.
      if (val.includes(' ')) {
        lines.push(
          `      <action application="transfer" data="${xmlEscape(val)}"/>`,
        );
      } else if (val) {
        lines.push(
          `      <action application="transfer" data="in_group_${xmlEscape(val)} XML default"/>`,
        );
      } else {
        lines.push('      <action application="hangup"/>');
      }
      break;
    case 'extension':
      if (val) {
        lines.push(
          `      <action application="bridge" data="user/${xmlEscape(val)}"/>`,
        );
      } else {
        lines.push('      <action application="hangup"/>');
      }
      break;
    case 'call_menu':
      if (val) {
        lines.push(
          `      <action application="execute_extension" data="call_menu_${xmlEscape(val)} XML default"/>`,
        );
      } else {
        lines.push('      <action application="hangup"/>');
      }
      break;
    case 'did':
      if (val) {
        lines.push(
          `      <action application="bridge" data="sofia/gateway/${xmlEscape(defaultGateway)}/${xmlEscape(val)}"/>`,
        );
      } else {
        lines.push('      <action application="hangup"/>');
      }
      break;
    case 'repeat':
      // Loop back to the menu's own entry by re-executing the
      // extension. max_retries on the play_and_get_digits prevents
      // an infinite loop — once retries are exhausted the
      // default-action condition fires.
      lines.push(
        `      <action application="execute_extension" data="call_menu_${xmlEscape(menu.id)} XML default"/>`,
      );
      break;
    default:
      // Unknown action_type — log and hang up. Shouldn't happen
      // because Zod validates at write time, but defensive guard.
      lines.push(
        `      <action application="log" data="ERR [call-menu] unknown action_type '${xmlEscape(actionType)}'"/>`,
      );
      lines.push('      <action application="hangup"/>');
  }
  return lines.join('\n');
}

function digitRegex(digit: string): string {
  // Most digits map cleanly to a regex literal. '*' must be
  // backslash-escaped; '#' is fine literal.
  if (digit === '*') return '\\*';
  return digit;
}

export function buildCallMenuDialplanXml(input: DialplanInputs): string {
  const { menu, options } = input;
  const defaultGateway = input.defaultGateway ?? 'default';

  const timeoutMs = Math.max(1, menu.timeout_seconds) * 1000;
  const retries = Math.max(1, menu.max_retries);
  const prompt = (menu.prompt_path ?? '').trim() || 'ivr/ivr-please_choose_one_of_the_following_options.wav';
  const invalid = (menu.invalid_audio_path ?? '').trim() || 'ivr/ivr-that_was_an_invalid_entry.wav';

  // Sort options by ordering so the generated XML is stable
  // (matters for diff-readability across re-saves with the same
  // content). Then by digit as a tiebreaker.
  const sorted = [...options].sort((a, b) => {
    const o = a.ordering - b.ordering;
    return o !== 0 ? o : a.digit.localeCompare(b.digit);
  });

  const optionConditions = sorted
    .map((opt) => {
      const todAttr =
        opt.tod_start && opt.tod_end
          ? ` time-of-day="${xmlEscape(opt.tod_start)}-${xmlEscape(opt.tod_end)}"`
          : '';
      const actions = actionXml(
        opt.action_type,
        opt.action_value,
        opt.dispo_code,
        menu,
        defaultGateway,
      );
      return `    <condition field="\${menu_digit}" expression="^${digitRegex(opt.digit)}$"${todAttr} break="on-true">
${actions}
    </condition>`;
    })
    .join('\n');

  const defaultActions = actionXml(
    menu.default_action_type,
    menu.default_action_value,
    null,
    menu,
    defaultGateway,
  );

  return `<include>
  <!--
    Iter 152 — auto-generated from call_menus row ${menu.id} (${xmlEscape(menu.name)}).
    DO NOT EDIT — regenerated every time the menu is saved via the
    admin GUI. Hand edits will be lost.
  -->
  <extension name="call_menu_${menu.id}" continue="false">
    <condition field="destination_number" expression="^call_menu_${menu.id}$" break="never">
      <action application="log" data="INFO [call-menu] entered ${menu.id} (${xmlEscape(menu.name)}) uuid=\${uuid}"/>
      <action application="set" data="dialeros_menu_id=${menu.id}"/>
      <action application="event" data="Event-Subclass=dialeros::menu_press,Event-Name=CUSTOM,dialeros_menu_id=${menu.id},dialeros_menu_event=entered"/>
      <action application="play_and_get_digits" data="1 1 ${retries} ${timeoutMs} # ${xmlEscape(prompt)} ${xmlEscape(invalid)} menu_digit \\d "/>
    </condition>
${optionConditions}
    <!-- Default branch: no option matched + retries exhausted -->
    <condition>
${defaultActions}
    </condition>
  </extension>
</include>
`;
}

/** Where the generated .xml lands. FS scans this dir + reloads
 * the file when `reloadxml` runs over ESL/fs_cli. */
export function callMenuDialplanPath(menuId: string): string {
  return `/etc/freeswitch/dialplan/default/call_menu_${menuId}.xml`;
}
