// @ts-check
// 셸 완성 스크립트 — `cloudonym completion <bash|zsh|fish>` 가 stdout 에 낸다. 명령 · 플래그는 main.mjs 의 표(COMMANDS · OPTIONS)에서 받는다 — 여기서 따로 적지 않는다(표와 어긋나지 않게)

export const SHELLS = /** @type {const} */ (['bash', 'zsh', 'fish']);

/**
 * 값을 받는 플래그의 후보 — 파일 자리는 셸의 파일 완성, 나머지는 고정 목록. 없는 플래그는 값 없이 둔다
 * @typedef {{ files: string[], values: Record<string, readonly string[]> }} ValueHints
 */

/**
 * @param {'bash' | 'zsh' | 'fish'} shell
 * @param {readonly string[]} commands
 * @param {Record<string, { type: 'string' | 'boolean', short?: string }>} options
 * @param {ValueHints} hints
 * @returns {string}
 */
export function completionScript(shell, commands, options, hints) {
  const longs = Object.keys(options).map((k) => `--${k}`);
  const shorts = Object.values(options).flatMap((o) => (o.short ? [`-${o.short}`] : []));
  /** 플래그 이름(긴 · 짧은) 둘 다 — case 줄에 쓴다 @param {string} k */
  const names = (k) => [`--${k}`, ...(options[k]?.short ? [`-${options[k].short}`] : [])];
  const fileFlags = hints.files.flatMap(names);
  if (shell === 'bash') {
    return [
      '# cloudonym bash completion — add to ~/.bashrc: eval "$(cloudonym completion bash)"',
      '_cloudonym() {',
      '  local cur="${COMP_WORDS[COMP_CWORD]}" prev="${COMP_WORDS[COMP_CWORD-1]}"',
      '  case "${prev}" in',
      ...(fileFlags.length > 0 ? [`    ${fileFlags.join('|')}) COMPREPLY=($(compgen -f -- "\${cur}")); return ;;`] : []),
      ...Object.entries(hints.values).map(([k, vals]) => `    ${names(k).join('|')}) COMPREPLY=($(compgen -W "${vals.join(' ')}" -- "\${cur}")); return ;;`),
      `    completion) COMPREPLY=($(compgen -W "${SHELLS.join(' ')}" -- "\${cur}")); return ;;`,
      '  esac',
      '  if [ "${COMP_CWORD}" -eq 1 ] && [[ "${cur}" != -* ]]; then',
      `    COMPREPLY=($(compgen -W "${commands.join(' ')}" -- "\${cur}"))`,
      '  else',
      `    COMPREPLY=($(compgen -W "${[...longs, ...shorts].join(' ')}" -- "\${cur}"))`,
      '  fi',
      '}',
      'complete -o default -F _cloudonym cloudonym',
      '',
    ].join('\n');
  }
  if (shell === 'zsh') {
    return [
      '#compdef cloudonym',
      '# cloudonym zsh completion — add to ~/.zshrc: source <(cloudonym completion zsh)',
      '# or save it as _cloudonym in a directory of $fpath',
      '_cloudonym() {',
      '  if (( CURRENT == 2 )) && [[ "${words[CURRENT]}" != -* ]]; then',
      `    compadd -- ${commands.join(' ')}`,
      '    return',
      '  fi',
      '  case "${words[CURRENT-1]}" in',
      ...(fileFlags.length > 0 ? [`    ${fileFlags.join('|')}) _files; return ;;`] : []),
      ...Object.entries(hints.values).map(([k, vals]) => `    ${names(k).join('|')}) compadd -- ${vals.join(' ')}; return ;;`),
      `    completion) compadd -- ${SHELLS.join(' ')}; return ;;`,
      '  esac',
      `  compadd -- ${[...longs, ...shorts].join(' ')}`,
      '}',
      'if [ "${funcstack[1]}" = "_cloudonym" ]; then',
      '  _cloudonym "$@"',
      'else',
      '  compdef _cloudonym cloudonym',
      'fi',
      '',
    ].join('\n');
  }
  // fish — 명령은 첫 자리에서만, 플래그는 어디서나
  const lines = [
    '# cloudonym fish completion — save as ~/.config/fish/completions/cloudonym.fish: cloudonym completion fish > ~/.config/fish/completions/cloudonym.fish',
    'complete -c cloudonym -f',
    `complete -c cloudonym -n __fish_use_subcommand -a '${commands.join(' ')}'`,
    `complete -c cloudonym -n '__fish_seen_subcommand_from completion' -a '${SHELLS.join(' ')}'`,
  ];
  for (const [k, o] of Object.entries(options)) {
    const short = o.short ? ` -s ${o.short}` : '';
    const vals = hints.values[k];
    const arg = hints.files.includes(k) ? ' -r -F' : vals ? ` -x -a '${vals.join(' ')}'` : o.type === 'string' ? ' -x' : '';
    lines.push(`complete -c cloudonym -l ${k}${short}${arg}`);
  }
  return `${lines.join('\n')}\n`;
}
