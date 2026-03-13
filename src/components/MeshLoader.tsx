import { motion, type Variants } from 'framer-motion'

export function MeshLoader() {
  const containerVariants: Variants = {
    animate: {
      transition: {
        staggerChildren: 0.2,
      },
    },
  }

  const dotVariants: Variants = {
    initial: {
      scale: 0.5,
      opacity: 0.3,
    },
    animate: {
      scale: 1,
      opacity: 1,
      transition: {
        duration: 0.8,
        repeat: Infinity,
        repeatType: "reverse",
        ease: "easeInOut",
      },
    },
  }

  const lineVariants: Variants = {
    initial: {
      pathLength: 0,
      opacity: 0,
    },
    animate: {
      pathLength: 1,
      opacity: 0.5,
      transition: {
        duration: 1.5,
        repeat: Infinity,
        repeatType: "reverse",
        ease: "easeInOut",
      },
    },
  }

  return (
    <div className="flex flex-col items-center justify-center gap-6">
      <motion.svg
        width="100"
        height="100"
        viewBox="0 0 100 100"
        className="text-primary"
        variants={containerVariants}
        initial="initial"
        animate="animate"
      >
        {/* Connection Lines */}
        <motion.line x1="50" y1="20" x2="80" y2="50" stroke="currentColor" strokeWidth="2" strokeLinecap="round" variants={lineVariants} />
        <motion.line x1="80" y1="50" x2="50" y2="80" stroke="currentColor" strokeWidth="2" strokeLinecap="round" variants={lineVariants} />
        <motion.line x1="50" y1="80" x2="20" y2="50" stroke="currentColor" strokeWidth="2" strokeLinecap="round" variants={lineVariants} />
        <motion.line x1="20" y1="50" x2="50" y2="20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" variants={lineVariants} />
        <motion.line x1="50" y1="20" x2="50" y2="50" stroke="currentColor" strokeWidth="2" strokeLinecap="round" variants={lineVariants} />
        <motion.line x1="20" y1="50" x2="50" y2="50" stroke="currentColor" strokeWidth="2" strokeLinecap="round" variants={lineVariants} />
        <motion.line x1="80" y1="50" x2="50" y2="50" stroke="currentColor" strokeWidth="2" strokeLinecap="round" variants={lineVariants} />

        {/* Nodes */}
        <motion.circle cx="50" cy="20" r="6" fill="currentColor" variants={dotVariants} />
        <motion.circle cx="80" cy="50" r="6" fill="currentColor" variants={dotVariants} />
        <motion.circle cx="50" cy="80" r="6" fill="currentColor" variants={dotVariants} />
        <motion.circle cx="20" cy="50" r="6" fill="currentColor" variants={dotVariants} />
        
        {/* Center Node */}
        <motion.circle cx="50" cy="50" r="8" fill="currentColor" variants={dotVariants} />
      </motion.svg>
      <div className="font-mono text-sm tracking-widest text-primary/80 uppercase animate-pulse">
        Syncing MESH
      </div>
    </div>
  )
}