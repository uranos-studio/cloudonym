// 클립보드 복사 — navigator.clipboard 는 보안 컨텍스트(HTTPS · localhost)에서만 있고 권한이 없으면 거부한다. 결과를 셋으로 돌려주고 화면이 안내 문구를 고른다
export type CopyResult = 'copied' | 'unavailable' | 'failed';

export const COPY_MESSAGE: Record<CopyResult, string> = {
  copied: '복사했습니다',
  unavailable: '클립보드를 쓸 수 없습니다 — HTTPS 로 열거나 값을 직접 선택해 복사하세요',
  failed: '복사 권한이 없습니다 — 값을 직접 선택해 복사하세요',
};

type Writer = Pick<Clipboard, 'writeText'>;

function defaultWriter(): Writer | undefined {
  return typeof navigator === 'undefined' ? undefined : navigator.clipboard;
}

export async function copyText(text: string, writer: Writer | undefined = defaultWriter()): Promise<CopyResult> {
  if (!writer) return 'unavailable';
  try {
    await writer.writeText(text);
    return 'copied';
  } catch {
    return 'failed';
  }
}
