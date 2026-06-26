import { CORRANZO_LOGO_SRC } from '../features/brand/corranzoBrand.js'

export default function CorranzoLogo({
  className = '',
  alt = 'Corranzo',
  width,
  height,
  loading = 'lazy',
  decoding = 'async',
  ...rest
}) {
  return (
    <img
      src={CORRANZO_LOGO_SRC}
      alt={alt}
      className={className}
      width={width}
      height={height}
      loading={loading}
      decoding={decoding}
      {...rest}
    />
  )
}
