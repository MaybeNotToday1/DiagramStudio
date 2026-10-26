<script setup lang="ts">
import { defaultStyle, type DiagramStyle } from '../domain/model'

const style = defineModel<DiagramStyle>({ required: true })
const switches = [
  ['showAttributes', '显示属性', '隐藏后保留属性文字和手工位置'],
  ['showRelationships', '显示关联', '显示实体间的关系节点与连线'],
  ['showCardinalities', '关系基数文字', '在线上显示 1、N 等基数'],
  ['primaryUnderline', '主键下划线', '为主键属性添加下划线'],
  ['autoWidth', '自适应宽度', '按文字自动加宽；长文字仍可换行'],
  ['smartConnections', '智能连接线', '沿节点边缘连接；关闭则使用四向锚点'],
] as const
const colors = [['entityFill', '实体填充'], ['attributeFill', '属性填充'], ['relationFill', '关系填充'], ['ink', '文字颜色'], ['lineColor', '线条颜色'], ['background', '画布背景']] as const
function theme(colored: boolean) { style.value = { ...defaultStyle(), cardinalities: style.value.cardinalities, ...(colored ? { entityFill: '#e5f1ec', attributeFill: '#faf6ed', relationFill: '#e9edf5', ink: '#304c44', lineColor: '#304c44' } : {}) } }
</script>

<template>
  <div class="style-settings">
    <div class="theme-picker"><button @click="theme(false)"><span class="theme-preview mono">◇</span>黑白论文</button><button @click="theme(true)"><span class="theme-preview colored">◇</span>自然配色</button></div>
    <div class="style-switches"><label v-for="[key, title, help] in switches" :key="key"><div><strong>{{ title }}</strong><small>{{ help }}</small></div><el-switch v-model="style[key]" :aria-label="title"/></label></div>
    <el-form label-position="top">
      <section class="style-section"><h3>全局样式 <small>TYPOGRAPHY & COLOR</small></h3>
        <div class="form-grid">
          <el-form-item label="全局字体"><el-select v-model="style.fontFamily" aria-label="全局字体"><el-option label="思源宋体 / Noto Serif SC" value="Noto Serif SC"/><el-option label="系统无衬线字体" value="sans-serif"/><el-option label="宋体（需本机安装）" value="SimSun"/></el-select></el-form-item>
          <el-form-item label="字号"><el-input-number v-model="style.fontSize" aria-label="字号" :min="10" :max="36"/></el-form-item>
          <el-form-item label="字体粗细"><el-select v-model="style.fontWeight" aria-label="字体粗细"><el-option label="正常" value="normal"/><el-option label="加粗" value="bold"/></el-select></el-form-item>
          <el-form-item label="主键下划线粗细"><el-input-number v-model="style.underlineWidth" aria-label="主键下划线粗细" :disabled="!style.primaryUnderline" :min="0.5" :max="5" :step="0.5"/></el-form-item>
        </div>
        <div class="color-grid"><label v-for="[key, title] in colors" :key="key">{{ title }}<input type="color" v-model="style[key]" :aria-label="title"></label></div>
        <div class="label-background"><label>连线文字背景<input type="color" :aria-label="'连线文字背景'" :value="style.labelBackground === 'transparent' ? '#ffffff' : style.labelBackground" :disabled="style.labelBackground === 'transparent'" @input="style.labelBackground = ($event.target as HTMLInputElement).value"></label><el-checkbox :model-value="style.labelBackground === 'transparent'" @change="style.labelBackground = $event ? 'transparent' : style.background">透明</el-checkbox></div>
      </section>
      <section v-for="[kind, title] in ([['entity', '实体节点'], ['attribute', '属性节点'], ['relation', '关系节点']] as const)" :key="kind" class="style-section"><h3>{{ title }}</h3>
        <div class="form-grid">
          <el-form-item label="宽度"><el-input-number v-model="style[`${kind}Width`]" :aria-label="`${title.slice(0, 2)}宽度`" :min="60" :max="500" :step="5"/></el-form-item>
          <el-form-item label="最小高度"><el-input-number v-model="style[`${kind}Height`]" :aria-label="`${title.slice(0, 2)}高度`" :min="30" :max="300" :step="5"/></el-form-item>
          <el-form-item v-if="kind !== 'entity'" label="形状"><el-select v-model="style[`${kind}Shape`]" :aria-label="`${title.slice(0, 2)}形状`"><el-option label="椭圆" value="ellipse"/><el-option label="菱形" value="diamond"/><el-option label="矩形" value="rect"/></el-select></el-form-item>
        </div>
        <template v-if="kind === 'attribute'"><div class="form-grid">
          <el-form-item label="属性排列"><el-select v-model="style.attributeLayout" aria-label="属性排列"><el-option label="环绕分布" value="circular"/><el-option label="水平排列" value="horizontal"/><el-option label="垂直排列" value="vertical"/></el-select></el-form-item>
          <el-form-item label="连线长度（0 为自动）"><el-input-number v-model="style.attributeDistance" aria-label="属性连线长度" :min="0" :max="600" :step="10"/></el-form-item>
        </div><p class="form-help">长度以节点中心距离为基准；为容纳节点会保留最小间隔。</p></template>
      </section>
      <section class="style-section"><h3>线条与排版</h3><div class="form-grid">
        <el-form-item label="连线粗细"><el-input-number v-model="style.lineWidth" aria-label="连线粗细" :min="0.5" :max="5" :step="0.5"/></el-form-item>
        <el-form-item label="边框粗细"><el-input-number v-model="style.borderWidth" aria-label="边框粗细" :min="0.5" :max="5" :step="0.5"/></el-form-item>
        <el-form-item label="矩形圆角"><el-input-number v-model="style.radius" aria-label="矩形圆角" :min="0" :max="24"/></el-form-item>
      </div><el-form-item label="整体节点倍率"><el-slider v-model="style.nodeScale" aria-label="整体节点倍率" :min="1" :max="2" :step="0.1"/></el-form-item><el-form-item label="排版间距"><el-slider v-model="style.spacing" aria-label="排版间距" :min="0.6" :max="2" :step="0.1"/></el-form-item></section>
    </el-form>
    <p class="form-help style-help">应用排列方式、连线长度或排版间距时，会围绕各实体重新排列属性。其他样式保留节点位置。可撤销全部修改。关闭自适应宽度后按设定宽度换行，高度仍会扩展以容纳文字。</p>
  </div>
</template>
