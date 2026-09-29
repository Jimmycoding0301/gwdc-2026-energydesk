import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import type { ComparisonReport } from '../shared/types';
import { procurementBrief } from '../shared/brief';

export default function BriefCopy({ report, selected, dirty }: { report: ComparisonReport; selected: string | null; dirty: boolean }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [fallback, setFallback] = useState('');
  const textarea = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { setState('idle'); setFallback(''); }, [report.id, selected, dirty]);
  async function copy() {
    const text = procurementBrief(report, selected, { inputChanged: dirty });
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(text); setState('copied'); setFallback('');
    } catch { setState('failed'); setFallback(text); }
  }
  return <div className="brief-copy"><button className="button secondary small" onClick={copy}>{state === 'copied' ? <Check size={14} /> : <Copy size={14} />}{state === 'copied' ? '关账简报已复制' : '复制关账简报'}</button>{state === 'copied' && <span className="sr-only" role="status">已复制当前快照和方案。</span>}{state === 'failed' && <div className="brief-fallback"><p role="alert">无法自动复制。请手动复制。</p><label htmlFor="brief-text">关账采购简报</label><textarea id="brief-text" ref={textarea} readOnly value={fallback} /><div className="result-actions"><button className="button secondary small" onClick={() => { textarea.current?.focus(); textarea.current?.select(); }}>全选</button><button className="button secondary small" onClick={() => { setState('idle'); setFallback(''); }}>收起</button></div></div>}</div>;
}
