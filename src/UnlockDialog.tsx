import { formatCode, getCredits, redeemCode } from './license';
import { productConfig } from './product';

type Props = {
  onClose: () => void;
};

export default function UnlockDialog({ onClose }: Props) {
  const [value, setValue] = React.useState('');
  const [message, setMessage] = React.useState<string | null>(null);
  const [succeeded, setSucceeded] = React.useState(false);
  const credits = getCredits();

  function submit() {
    const result = redeemCode(value);
    if (result.ok) {
      setSucceeded(true);
      setMessage(`兑换成功，当前剩余 ${result.credits} 次导出。`);
      setValue('');
      return;
    }
    setMessage(
      result.reason === 'format'
        ? '兑换码格式不对，应为 12 位字母数字（可带横线）。'
        : result.reason === 'used'
          ? '这个兑换码已经在本设备兑换过了。'
          : '兑换码无效，请核对后重试。',
    );
  }

  return (
    <div className="unlock-backdrop" role="presentation" onClick={onClose}>
      <section
        className="unlock-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="兑换导出次数"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="unlock-header">
          <div>
            <h2>兑换导出次数</h2>
            <p>高清图纸与用量清单每次导出消耗 1 次。</p>
          </div>
          <button className="unlock-close" type="button" aria-label="关闭" onClick={onClose}>
            ×
          </button>
        </header>

        <div className="unlock-credits">
          当前剩余 <strong>{credits}</strong> 次
        </div>

        <label className="unlock-field">
          <span>兑换码</span>
          <input
            autoFocus
            value={value}
            placeholder="XXXX-XXXX-XXXX"
            onChange={(event) => {
              const next = formatCode(event.target.value);
              setValue(next);
              setMessage(null);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submit();
            }}
          />
        </label>

        {message && <p className={succeeded ? 'unlock-message ok' : 'unlock-message'}>{message}</p>}

        <button className="primary unlock-submit" type="button" onClick={submit} disabled={formatCode(value).length < 14}>
          兑换
        </button>

        <div className="unlock-buy">
          <strong>还没有兑换码？</strong>
          <p>{productConfig.buyChannel} 购买，{productConfig.priceLabel}。</p>
          <p>{productConfig.buyNote}</p>
        </div>
      </section>
    </div>
  );
}
