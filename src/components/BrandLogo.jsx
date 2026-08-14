import { assetPath } from '../lib/utils';

export default function BrandLogo({ className = '', alt = '' }) {
  return (
    <img
      className={className}
      src={assetPath('/assets/brand/vpfr-logo.webp')}
      alt={alt}
    />
  );
}
