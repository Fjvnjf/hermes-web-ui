<script setup lang="ts">
import { ref } from 'vue'
import { useMessage, NButton, NInput } from 'naive-ui'
import CommandGlyph from '@/components/common/CommandGlyph.vue'
import { loginWithPassword } from '@/api/auth'
import { setApiKey } from '@/api/client'

const emit = defineEmits<{
  authenticated: []
}>()

const message = useMessage()
const username = ref('hermes')
const password = ref('')
const loading = ref(false)

async function submitLogin() {
  if (!username.value.trim() || !password.value) {
    message.error('Enter username and password')
    return
  }

  loading.value = true
  try {
    const token = await loginWithPassword(username.value.trim(), password.value)
    setApiKey(token)
    emit('authenticated')
  } catch {
    message.error('Authentication failed')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <form class="command-login" @submit.prevent="submitLogin">
    <div class="login-mark">
      <CommandGlyph :size="34" />
    </div>
    <p class="login-kicker">Hermes Command Center</p>
    <h1>Sign In</h1>

    <div class="login-fields">
      <NInput
        v-model:value="username"
        size="large"
        placeholder="Username"
        autocomplete="username"
        :input-props="{ 'aria-label': 'Username' }"
      />
      <NInput
        v-model:value="password"
        size="large"
        type="password"
        show-password-on="click"
        placeholder="Password"
        autocomplete="current-password"
        :input-props="{ 'aria-label': 'Password' }"
        @keyup.enter="submitLogin"
      />
    </div>

    <NButton
      attr-type="submit"
      type="primary"
      size="large"
      block
      :loading="loading"
    >
      Enter Command Center
    </NButton>
  </form>
</template>

<style scoped lang="scss">
.command-login {
  width: min(420px, calc(100vw - 32px));
  padding: 34px;
  border: 1px solid rgba(99, 140, 171, 0.36);
  border-radius: 8px;
  background:
    linear-gradient(145deg, rgba(15, 30, 43, 0.96), rgba(4, 12, 20, 0.98)),
    #06111b;
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.38);
}

.login-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border: 1px solid rgba(78, 195, 247, 0.35);
  border-radius: 8px;
  background: rgba(78, 195, 247, 0.08);
  color: #4ec3f7;
}

.login-kicker {
  margin: 22px 0 8px;
  color: #d6b35a;
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0;
  text-transform: uppercase;
}

h1 {
  margin: 0;
  color: #f4f7fb;
  font-size: 1.85rem;
  line-height: 1.12;
  letter-spacing: 0;
}

.login-fields {
  display: grid;
  gap: 12px;
  margin: 26px 0 18px;
}

@media (max-width: 560px) {
  .command-login {
    padding: 26px 20px;
  }
}
</style>
