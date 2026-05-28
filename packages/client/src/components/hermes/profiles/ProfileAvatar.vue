<script setup lang="ts">
import { computed } from 'vue'
import type { ProfileAvatar } from '@/api/hermes/profiles'

const props = withDefaults(defineProps<{
  name: string
  avatar?: ProfileAvatar | null
  size?: number
}>(), {
  size: 24,
})

const avatarSeed = computed(() => props.avatar?.type === 'generated' && props.avatar.seed ? props.avatar.seed : props.name || 'default')
const initials = computed(() => {
  const words = (props.name || 'H').trim().split(/[\s._-]+/).filter(Boolean)
  const chars = words.length > 1
    ? `${words[0][0] || ''}${words[1][0] || ''}`
    : (words[0] || 'H').slice(0, 2)
  return chars.toUpperCase()
})

function hashSeed(value: string) {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0
  }
  return hash
}

const palette = ['#4fc3f7', '#c9a84c', '#66bb6a', '#ffa726', '#8da0bc']
const accentColor = computed(() => palette[hashSeed(avatarSeed.value) % palette.length])
const style = computed(() => ({
  width: `${props.size}px`,
  height: `${props.size}px`,
  flexBasis: `${props.size}px`,
  '--avatar-size': `${props.size}px`,
  '--avatar-accent': accentColor.value,
}))
</script>

<template>
  <span class="profile-avatar-view" :style="style">
    <img
      v-if="avatar?.type === 'image' && avatar.dataUrl"
      class="profile-avatar-image"
      :src="avatar.dataUrl"
      alt=""
      draggable="false"
    >
    <span v-else class="profile-avatar-monogram" aria-hidden="true">
      <span class="profile-avatar-grid"></span>
      <span class="profile-avatar-initials">{{ initials }}</span>
    </span>
  </span>
</template>

<style scoped>
.profile-avatar-view {
  display: inline-flex;
  flex: 0 0 auto;
  border-radius: 50%;
  overflow: hidden;
  background: #060a12;
  border: 1px solid rgba(79, 195, 247, 0.35);
}

.profile-avatar-image,
.profile-avatar-monogram {
  width: 100%;
  height: 100%;
  display: block;
}

.profile-avatar-image {
  object-fit: cover;
}

.profile-avatar-monogram {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--avatar-accent);
  background:
    linear-gradient(135deg, rgba(19, 26, 40, 0.96), rgba(6, 10, 18, 0.98));
}

.profile-avatar-grid {
  position: absolute;
  inset: 22%;
  border: 1px solid currentColor;
  border-radius: 3px;
  opacity: 0.42;
}

.profile-avatar-grid::before,
.profile-avatar-grid::after {
  content: '';
  position: absolute;
  background: currentColor;
  opacity: 0.72;
}

.profile-avatar-grid::before {
  left: 50%;
  top: 0;
  bottom: 0;
  width: 1px;
}

.profile-avatar-grid::after {
  left: 0;
  right: 0;
  top: 50%;
  height: 1px;
}

.profile-avatar-initials {
  position: relative;
  z-index: 1;
  font-size: max(9px, calc(var(--avatar-size, 24px) * 0.34));
  font-weight: 800;
  line-height: 1;
  letter-spacing: 0;
}
</style>
