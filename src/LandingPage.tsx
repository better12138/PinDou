import { getCredits } from './license';
import { productConfig } from './product';

type Props = {
  onStart: () => void;
};

const heartPattern = [
  '0011100011100',
  '0111110111110',
  '1111111111111',
  '1111111111111',
  '1111111111111',
  '0111111111110',
  '0011111111100',
  '0001111111000',
  '0000111110000',
  '0000011100000',
  '0000001000000',
];

const steps = [
  { title: '上传图片', body: '人物、宠物、风景都可以，图片只在浏览器里处理，不上传服务器。' },
  { title: '调参数', body: '选卡通或写实风格，设定宽度和色数上限，画布会实时更新。' },
  { title: '导出图纸', body: '高清 PNG / PDF 带色号与坐标，再导一份 Excel 用量清单照着买豆。' },
];

const features = [
  { title: 'MARD + Artkal 双色卡', body: '291 色与 176 色两套真实色号，切换品牌后每颗豆都标好可购买的编号。' },
  { title: '3D 实物预览', body: '带中孔豆子、清漆高光和柔和阴影，先看成品再开熨。' },
  { title: '本地处理', body: '图片转换和编辑都在浏览器完成，速度取决于你的电脑，也不担心图片外泄。' },
  { title: '完整编辑工具', body: '画笔、填充、消除、换色、形状、文字、多图层，生成后还能继续修图。' },
  { title: '用量清单', body: '按颜色统计颗数并估算包数，导出 Excel 直接下单买豆。' },
  { title: '人像友好', body: '人像自动抠图与自动取景，做头像、情侣照、宠物照更省事。' },
];

const faqs = [
  { q: '需要注册账号吗？', a: '不需要。打开网页就能做图，编辑记录自动保存在当前浏览器里。' },
  { q: '为什么导出要收费？', a: '做图、预览、编辑都免费，高清图纸和用量清单每次导出 0.5 元，用来覆盖开发与维护成本。' },
  { q: '兑换码怎么用？', a: '在页面右上角点“剩余次数”，输入 12 位兑换码即可增加 1 次导出额度。' },
  { q: '图片会上传吗？', a: '不会。转换、抠图、3D 预览全部在浏览器本地运行。' },
];

export default function LandingPage({ onStart }: Props) {
  const credits = getCredits();

  return (
    <main className="landing">
      <header className="landing-nav">
        <div className="landing-logo">
          <span className="landing-logo-dots" aria-hidden="true">
            <i style={{ background: '#F551A2' }} />
            <i style={{ background: '#FFC72C' }} />
            <i style={{ background: '#26D07C' }} />
            <i style={{ background: '#17656a' }} />
          </span>
          拼豆图纸生成器
        </div>
        <nav className="landing-nav-links" aria-label="页面导航">
          <a href="#features">功能</a>
          <a href="#pricing">价格</a>
          <a href="#faq">常见问题</a>
        </nav>
        <button className="primary landing-nav-cta" type="button" onClick={onStart}>
          {credits > 0 ? `继续制作（剩 ${credits} 次）` : '开始制作'}
        </button>
      </header>

      <section className="landing-hero">
        <div className="landing-hero-copy">
          <p className="landing-eyebrow">给小红书手工党做的图纸工具</p>
          <h1>
            把一张照片，
            <br />
            变成能照着拼的图纸
          </h1>
          <p className="landing-lede">
            自动分色、标注 MARD / Artkal 色号，导出高清 PNG、PDF 和 Excel 用量清单。从图片到上板，一次搞定。
          </p>
          <div className="landing-cta">
            <button className="primary landing-start" type="button" onClick={onStart}>
              开始生成图纸
            </button>
            <span className="landing-price">{productConfig.priceLabel} · 免注册</span>
          </div>
          <ul className="landing-points">
            <li>图片只在本地处理，不上传</li>
            <li>MARD 291 色 / Artkal 176 色</li>
            <li>3D 预览先看成品效果</li>
          </ul>
        </div>

        <div className="landing-demo" aria-hidden="true">
          <div className="landing-demo-top">
            <span>heart.png</span>
            <span>32 × 32 · 5 色</span>
          </div>
          <div className="landing-demo-board">
            {heartPattern.map((row, rowIndex) =>
              [...row].map((cell, columnIndex) => (
                <span
                  key={`${rowIndex}-${columnIndex}`}
                  className={cell === '1' ? 'demo-bead' : 'demo-cell'}
                  style={cell === '1' ? { background: rowIndex < 3 ? '#F551A2' : '#E9378C' } : undefined}
                />
              )),
            )}
          </div>
          <div className="landing-demo-meta">
            <span><i style={{ background: '#E9378C' }} /> S26 Magenta</span>
            <span><i style={{ background: '#FFC72C' }} /> S27 Yellow</span>
            <span>共 118 颗</span>
          </div>
        </div>
      </section>

      <section className="landing-steps">
        {steps.map((step, index) => (
          <article key={step.title}>
            <span className="landing-step-index">0{index + 1}</span>
            <h3>{step.title}</h3>
            <p>{step.body}</p>
          </article>
        ))}
      </section>

      <section id="features" className="landing-features">
        <header>
          <h2>为“拼得出来”而做的细节</h2>
          <p>不只是把图片变成格子，还把色号、数量、图纸尺寸都算清楚。</p>
        </header>
        <div className="landing-feature-grid">
          {features.map((feature) => (
            <article key={feature.title}>
              <h3>{feature.title}</h3>
              <p>{feature.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="pricing" className="landing-pricing">
        <div className="landing-pricing-card">
          <p className="landing-eyebrow">按次付费，不做订阅</p>
          <h2>0.5 元 / 次高清导出</h2>
          <ul>
            <li>做图、编辑、预览、3D 查看全部免费</li>
            <li>每次导出图纸或用量清单消耗 1 次</li>
            <li>兑换码永久有效，不绑定账号</li>
            <li>额度保存在本机浏览器</li>
          </ul>
          <button className="primary landing-start" type="button" onClick={onStart}>
            免费开始做图
          </button>
          <p className="landing-buy-note">
            购买兑换码：{productConfig.buyChannel}
          </p>
        </div>
        <div className="landing-pricing-side">
          <h3>导出内容</h3>
          <p>PNG / PDF 图纸：带坐标、网格、色号，A4 可直接打印。</p>
          <p>Excel 用量清单：按颜色统计颗数与包数，买豆不踩坑。</p>
          <p>JSON 编辑记录：随时回到上次进度继续改。</p>
        </div>
      </section>

      <section id="faq" className="landing-faq">
        <h2>常见问题</h2>
        {faqs.map((item) => (
          <details key={item.q}>
            <summary>{item.q}</summary>
            <p>{item.a}</p>
          </details>
        ))}
      </section>

      <footer className="landing-footer">
        <p>拼豆图纸生成器 · 浏览器本地处理</p>
        <p>色卡数据来自 Bitbead 公开色卡（CC BY 4.0）· 实际颜色以实物批次为准</p>
      </footer>
    </main>
  );
}
