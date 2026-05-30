<script setup lang="ts">
const sections = [
  'Approved investor presentation',
  'Approved feasibility summary',
  'Approved IRR scenario',
  'Approved risk register',
  'Approved evidence status',
  'Approved data-room documents',
]
</script>

<template>
  <main class="investor-portal">
    <section class="hero">
      <p class="eyebrow">Investor Approved View</p>
      <h1>Investor Portal</h1>
      <p>
        This portal is read-only and designed for approved material only. Raw chats, memory, files,
        formulas, costs, supplier quotes, and system tools are not available here.
      </p>
    </section>

    <section class="approved-grid" aria-label="Approved investor sections">
      <article v-for="section in sections" :key="section" class="approved-card">
        <span class="status">Approved only</span>
        <h2>{{ section }}</h2>
        <p>Show content here only after the owner approves it for investor viewing.</p>
      </article>
    </section>
  </main>
</template>

<style scoped lang="scss">
@use "@/styles/variables" as *;

.investor-portal {
  min-height: 100%;
  padding: 28px;
  background: $bg-primary;
}

.hero {
  max-width: 920px;
  margin-bottom: 24px;
}

.eyebrow {
  color: $accent-primary;
  text-transform: uppercase;
  font-size: 12px;
  letter-spacing: .08em;
  margin: 0 0 8px;
}

h1, h2 {
  color: $text-primary;
}

h1 {
  margin: 0 0 12px;
}

p {
  color: $text-secondary;
}

.approved-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 14px;
}

.approved-card {
  border: 1px solid $border-color;
  background: $bg-secondary;
  border-radius: 8px;
  padding: 18px;
}

.status {
  color: $accent-info;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: .08em;
}
</style>
