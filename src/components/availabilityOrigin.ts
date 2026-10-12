// 버킷 이름 「Check」(D83)가 브라우저에서 직접 묻는 곳 — availability.ts(fetch · 브라우저 타입)와 떼어 둔 것은
// api 시험(privacy-sync.test)이 Workers 타입으로 이 파일만 읽게 하려는 것이다 (copyTargets.ts 와 같은 까닭)
export const AVAILABILITY_ORIGIN = 'https://storage.googleapis.com';
