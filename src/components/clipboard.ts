// 클립보드 복사 — navigator.clipboard 는 보안 컨텍스트(HTTPS · localhost)에서만 있고 권한이 없으면 거부한다. 결과를 셋으로 돌려주고 화면이 안내 문구를 고른다
import { en } from '../messages/en';

export type CopyResult = 'copied' | 'unavailable' | 'failed';

/** 안내 문구는 사전이 정본이다 (D24) */
export const COPY_MESSAGE: Record<CopyResult, string> = {
  copied: en.ui.copy_done,
  unavailable: en.ui.copy_unavailable,
  failed: en.ui.copy_failed,
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
