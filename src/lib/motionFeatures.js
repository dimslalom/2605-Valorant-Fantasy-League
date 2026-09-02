// Isolated in its own module so Rollup/Vite can split it into its own async
// chunk. App.jsx imports LazyMotion/MotionConfig/LayoutGroup from 'motion/react'
// statically and domMax dynamically - pointing both at the same specifier in
// the same file collapses them into one chunk ([INEFFECTIVE_DYNAMIC_IMPORT]);
// routing the dynamic side through this standalone re-export avoids that.
export { domMax as default } from 'motion/react';
