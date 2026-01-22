export const CODE_PREFIX_MAP: Record<string, string> = {
  '후불)미디어': 'L미',
  '단말)미디어': 'L미',
  '후불)헬로': 'L헬',
  '단말)헬로': 'L헬',
  '선불)밸류컴': 'L밸',
  '선불)스마텔': 'L스',
  '후불)스카이': 'K스',
  '후불)엠모바일': 'K엠',
  '단말)KTM': 'K엠',
  '후불)카카오KT': 'K카',
  '선불)코드KT': 'K코',
  '후불)프리티LG': 'L프',
  '선불)프리티LG': 'L프',
  '후불)카카오SK': 'S카',
  '후불)텔링크SK': 'S텔',
  '후불)프리티SK': 'S프',
  '선불)프리티SK': 'S프',
};

// 접두어가 정의되지 않은 통신사는 검색 모달을 사용해야 함
export function hasCodePrefix(carrier: string): boolean {
  return carrier in CODE_PREFIX_MAP;
}

export function getCodePrefix(carrier: string): string | null {
  return CODE_PREFIX_MAP[carrier] || null;
}
