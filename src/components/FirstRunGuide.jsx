import { ArrowRight, Check, Database, Puzzle, Sparkles, X } from 'lucide-react'

const stepDefinitions = [
  {
    id: 'model',
    title: '连接模型',
    description: '选择服务并保存 API Key',
    action: '连接模型',
    icon: Database,
  },
  {
    id: 'extension',
    title: '安装浏览器扩展',
    description: '加载 extension/ 后刷新本页',
    action: '查看安装步骤',
    icon: Puzzle,
  },
  {
    id: 'firstTerm',
    title: '解释第一个词',
    description: '输入一个刚遇到的陌生术语',
    action: '试着解释一个词',
    icon: Sparkles,
  },
]

export default function FirstRunGuide({
  progress,
  collapsed,
  onCollapse,
  onExpand,
  onFocusCapture,
  onOpenExtension,
  onOpenModel,
}) {
  if (!progress || progress.complete) return null

  const actions = {
    model: onOpenModel,
    extension: onOpenExtension,
    firstTerm: onFocusCapture,
  }
  const nextStep = stepDefinitions.find((step) => !progress.steps[step.id])

  if (collapsed) {
    return (
      <section aria-label="首次使用进度" className="first-run-guide collapsed">
        <span className="first-run-count">{progress.completedCount}/3</span>
        <span className="first-run-collapsed-copy">
          <strong>继续完成上手</strong>
          <small>下一步：{nextStep?.title}</small>
        </span>
        <button className="first-run-continue" onClick={onExpand} type="button">
          继续
          <ArrowRight aria-hidden="true" size={15} />
        </button>
      </section>
    )
  }

  return (
    <section aria-labelledby="first-run-title" className="first-run-guide">
      <header className="first-run-heading">
        <div>
          <span>第一次使用</span>
          <h2 id="first-run-title">三步开始积累自己的术语库</h2>
        </div>
        <div className="first-run-heading-actions">
          <span>{progress.completedCount}/3 已完成</span>
          <button aria-label="暂时收起上手步骤" onClick={onCollapse} title="暂时收起" type="button">
            <X aria-hidden="true" size={17} />
          </button>
        </div>
      </header>

      <div aria-hidden="true" className="first-run-progress">
        <span style={{ width: `${(progress.completedCount / 3) * 100}%` }} />
      </div>

      <ol className="first-run-steps">
        {stepDefinitions.map(({ id, title, description, action, icon: Icon }) => {
          const complete = progress.steps[id]
          return (
            <li className={complete ? 'complete' : ''} key={id}>
              <span className="first-run-step-icon">
                {complete ? <Check aria-hidden="true" size={17} /> : <Icon aria-hidden="true" size={17} />}
              </span>
              <span className="first-run-step-copy">
                <strong>{title}</strong>
                <small>{complete ? '已完成' : description}</small>
              </span>
              {complete ? (
                <span className="first-run-done">完成</span>
              ) : (
                <button onClick={actions[id]} type="button">
                  {action}
                  <ArrowRight aria-hidden="true" size={14} />
                </button>
              )}
            </li>
          )
        })}
      </ol>
    </section>
  )
}
