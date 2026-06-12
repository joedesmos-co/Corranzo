export default function PracticeProgressBar({ label, value, subtle = false }) {
  const percent = Math.round((value ?? 0) * 100)

  return (
    <div
      className={`practice-progress${subtle ? ' practice-progress--subtle' : ''}`}
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div className="practice-progress__header">
        <span className="practice-progress__label">{label}</span>
        <span className="practice-progress__percent">{percent}%</span>
      </div>
      <div className="practice-progress__track">
        <div
          className="practice-progress__fill"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  )
}
