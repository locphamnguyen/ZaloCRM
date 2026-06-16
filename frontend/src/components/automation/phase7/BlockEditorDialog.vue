<!--
  BlockEditorDialog — Phase 1 MVP 2026-06-04 (Mockup 2 approved)
  3 cột: Components left + WYSIWYG middle + Zalo preview right.
  Variants tab 1/2/3 per text-message. Toggle Text/Rich text.
  AI generate variants defer tuần 2 (badge "Tuần 2").
  Folder visibility + Tag multi sub-bar.
-->
<template>
  <v-dialog
    :model-value="modelValue"
    fullscreen
    :scrim="false"
    content-class="bed-fs-content"
    transition="dialog-bottom-transition"
    persistent
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <div class="bed-wrap">
      <!-- Topbar -->
      <header class="bed-topbar">
        <button class="bed-back" @click="$emit('update:modelValue', false)">
          <v-icon size="16">mdi-arrow-left</v-icon> Quay lại
        </button>
        <input
          v-model="draft.name"
          type="text"
          class="bed-name-input"
          placeholder="Tên Khối (vd: Intro dự án Sunshine Q7)"
        />
        <span v-if="saving" class="bed-save-status">
          <v-icon size="13">mdi-timer-sand</v-icon> Đang lưu...
        </span>
        <span v-else-if="lastSavedAt" class="bed-save-status saved">
          <v-icon size="13">mdi-check</v-icon> Đã lưu {{ lastSavedHint }}
        </span>
        <div class="bed-actions">
          <span v-if="!canSave" class="bed-save-status" title="Bạn chỉ có quyền xem và dùng Khối này">
            <v-icon size="13">mdi-eye-outline</v-icon> Chỉ xem
          </span>
          <button v-else class="bed-btn bed-btn-primary" :disabled="saving" @click="onSave">
            <v-icon size="16">mdi-content-save-outline</v-icon> Lưu
          </button>
        </div>
      </header>

      <!-- Sub-bar: Folder + Tag -->
      <div class="bed-subbar">
        <div class="bed-sub-group">
          <span class="bed-sub-label"><v-icon size="14">mdi-folder-outline</v-icon> Thư mục:</span>
          <template v-if="!folderCreateOpen">
            <select v-model="draft.folderId" class="bed-folder-select">
              <option :value="null">— Chưa chọn —</option>
              <option
                v-for="f in folders"
                :key="f.id"
                :value="f.id"
              >
                {{ f.name }}
              </option>
            </select>
            <button class="bed-folder-new-btn" title="Tạo thư mục mới" @click="openFolderCreate">
              <v-icon size="13">mdi-folder-plus-outline</v-icon> Tạo mới
            </button>
            <span v-if="selectedFolderInfo" class="bed-vis-hint" :class="{ private: selectedFolderInfo.visibility === 'private' }">
              <v-icon size="12">{{ selectedFolderInfo.visibility === 'private' ? 'mdi-lock-outline' : 'mdi-earth' }}</v-icon>
              {{ selectedFolderInfo.visibility === 'private' ? 'Riêng tư (chỉ tôi)' : 'Công khai (cả org dùng)' }}
            </span>
          </template>
          <!-- Tạo thư mục inline ngay tại UI (anh chốt 2026-06-08, bỏ prompt/confirm). -->
          <template v-else>
            <input
              ref="folderNameRef"
              v-model="folderCreateName"
              type="text"
              class="bed-folder-name-input"
              placeholder="Tên thư mục mới..."
              maxlength="60"
              @keydown.enter.prevent="commitFolderCreate"
              @keydown.esc="cancelFolderCreate"
            />
            <div class="bed-folder-vis-toggle">
              <button
                class="bed-vis-opt"
                :class="{ active: folderCreateVis === 'public' }"
                @click="folderCreateVis = 'public'"
              >
                <v-icon size="12">mdi-earth</v-icon> Công khai
              </button>
              <button
                class="bed-vis-opt"
                :class="{ active: folderCreateVis === 'private' }"
                @click="folderCreateVis = 'private'"
              >
                <v-icon size="12">mdi-lock-outline</v-icon> Riêng tư
              </button>
            </div>
            <button class="bed-folder-save" :disabled="folderSaving || !folderCreateName.trim()" @click="commitFolderCreate">
              <v-icon size="13">{{ folderSaving ? 'mdi-timer-sand' : 'mdi-check' }}</v-icon> Lưu
            </button>
            <button class="bed-folder-cancel" @click="cancelFolderCreate">
              <v-icon size="13">mdi-close</v-icon>
            </button>
          </template>
        </div>
        <div class="bed-sub-divider"></div>
        <div class="bed-sub-group bed-tag-group">
          <span class="bed-sub-label"><v-icon size="14">mdi-tag-outline</v-icon> Tag:</span>
          <span
            v-for="tag in draft.tagIds"
            :key="tag"
            class="bed-tag-chip"
          >
            {{ tag }}
            <button class="bed-tag-x" @click="removeTag(tag)"><v-icon size="11">mdi-close</v-icon></button>
          </span>
          <!-- Nhập tag inline ngay tại UI (anh chốt 2026-06-08, bỏ prompt() Chrome xấu). -->
          <span v-if="tagInputOpen" class="bed-tag-input-wrap">
            <span class="bed-tag-hash">#</span>
            <input
              ref="tagInputRef"
              v-model="tagInputText"
              type="text"
              class="bed-tag-input"
              placeholder="SunshineQ7"
              maxlength="30"
              @focus="clearTagBlurTimer"
              @keydown.enter.prevent="commitTagAndContinue"
              @keydown.esc="cancelTagInput"
              @blur="onTagBlur"
            />
          </span>
          <button v-else class="bed-tag-add" @click="openTagInput">
            <v-icon size="13">mdi-plus</v-icon> Thêm tag
          </button>
        </div>
        <div class="bed-sub-divider"></div>
        <div class="bed-sub-group">
          <span class="bed-sub-label">Loại:</span>
          <span class="bed-action-pill">
            <v-icon size="13">{{ actionPillIcon }}</v-icon> {{ actionPillLabel }}
          </span>
          <select
            v-if="!isEdit"
            v-model="draft.actionType"
            class="bed-action-select"
          >
            <option value="send_message">Gửi tin nhắn</option>
            <option value="request_friend">Mời kết bạn</option>
            <option value="update_status">Đổi trạng thái</option>
          </select>
        </div>
      </div>

      <!-- 3 cột body -->
      <div class="bed-body">
        <!-- Col 1: Components list (chỉ cho send_message) -->
        <aside v-if="draft.actionType === 'send_message'" class="bed-col1">
          <div class="bed-col1-head">
            <span class="bed-col1-title">Thành phần ({{ components.length }})</span>
            <button class="bed-add-btn" @click="addComponentMenu = !addComponentMenu">
              <v-icon size="13">mdi-plus</v-icon> Thêm <v-icon size="13">mdi-chevron-down</v-icon>
            </button>
            <div v-if="addComponentMenu" class="bed-add-menu" @click.stop>
              <button @click="addComponent('text')"><v-icon size="15">mdi-format-text</v-icon> Tin text</button>
              <button @click="addComponent('image')"><v-icon size="15">mdi-image-outline</v-icon> Hình</button>
              <button @click="addComponent('album')"><v-icon size="15">mdi-image-multiple-outline</v-icon> Album</button>
              <button @click="addComponent('file')"><v-icon size="15">mdi-paperclip</v-icon> File</button>
              <button @click="addComponent('video')"><v-icon size="15">mdi-video-outline</v-icon> Video</button>
            </div>
          </div>
          <div class="bed-comp-list">
            <div
              v-for="(c, idx) in components"
              :key="idx"
              class="bed-comp-item"
              :class="{ active: activeComponentIdx === idx }"
              @click="activeComponentIdx = idx"
            >
              <span class="bed-comp-drag"><v-icon size="14">mdi-drag-vertical</v-icon></span>
              <span class="bed-comp-icon"><v-icon size="16">{{ componentIcon(c.kind) }}</v-icon></span>
              <div class="bed-comp-info">
                <div class="bed-comp-name">{{ componentLabel(c) }}</div>
                <div class="bed-comp-meta">{{ componentMeta(c) }}</div>
              </div>
              <button class="bed-comp-x" @click.stop="removeComponent(idx)"><v-icon size="13">mdi-close</v-icon></button>
            </div>
            <div v-if="components.length === 0" class="bed-comp-empty">
              Chưa có thành phần. Bấm "+ Thêm" để thêm tin text / hình / file.
            </div>
          </div>
        </aside>

        <!-- Col 1 alt: request_friend variants list -->
        <aside v-else-if="draft.actionType === 'request_friend'" class="bed-col1">
          <div class="bed-col1-head">
            <span class="bed-col1-title">Biến thể ({{ greetingVariants.length }})</span>
            <button class="bed-add-btn" @click="addGreeting">+ Thêm</button>
          </div>
          <div class="bed-comp-list">
            <div
              v-for="(g, idx) in greetingVariants"
              :key="idx"
              class="bed-comp-item"
              :class="{ active: activeGreetingIdx === idx }"
              @click="activeGreetingIdx = idx"
            >
              <span class="bed-comp-icon">
                <v-icon size="15" :color="idx === 0 ? 'var(--warning)' : undefined">{{ idx === 0 ? 'mdi-star' : 'mdi-dice-multiple-outline' }}</v-icon>
              </span>
              <div class="bed-comp-info">
                <div class="bed-comp-name">Biến thể {{ idx + 1 }} {{ idx === 0 ? '(mặc định)' : '' }}</div>
                <div class="bed-comp-meta">{{ greetingText(g).length }} ký tự</div>
              </div>
              <button v-if="greetingVariants.length > 1" class="bed-comp-x" @click.stop="removeGreeting(idx)"><v-icon size="13">mdi-close</v-icon></button>
            </div>
          </div>
        </aside>

        <!-- Col 2: Editor -->
        <section class="bed-col2">
          <!-- send_message: STACK card — render TẤT CẢ thành phần dọc từ trên xuống.
               Anh chốt 2026-06-06: block-builder style, mỗi component 1 card chiếm
               diện tích theo loại (text cao có toolbar, media gọn). Click card → active. -->
          <template v-if="draft.actionType === 'send_message'">
            <div class="bed-stack-scroll">
              <div
                v-for="(c, idx) in components"
                :key="idx"
                :ref="(el: any) => setStackCardRef(idx, el)"
                class="bed-stack-card"
                :class="{ active: activeComponentIdx === idx, 'is-text': c.kind === 'text' }"
                @click="activeComponentIdx = idx"
              >
                <!-- Card header -->
                <div class="bed-stack-head">
                  <span class="bed-stack-num">{{ idx + 1 }}</span>
                  <span class="bed-stack-icon"><v-icon size="15">{{ componentIcon(c.kind) }}</v-icon></span>
                  <span class="bed-stack-title">{{ componentTypeLabel(c.kind) }}</span>
                  <span class="bed-stack-spacer"></span>
                  <span class="bed-stack-drag" title="Kéo để sắp xếp"><v-icon size="15">mdi-drag-vertical</v-icon></span>
                  <button class="bed-stack-x" title="Xoá thành phần" @click.stop="removeComponent(idx)">
                    <v-icon size="14">mdi-close</v-icon>
                  </button>
                </div>

                <!-- Card body: TEXT — tab biến thể + editor riêng.
                     Click bất kỳ trong card bubble lên @click outer → set card active (mong muốn). -->
                <div v-if="c.kind === 'text'" class="bed-stack-body">
                  <div class="bed-variant-bar">
                    <button
                      v-for="(_v, vIdx) in textVariantsOf(c)"
                      :key="vIdx"
                      class="bed-var-tab"
                      :class="{ active: variantIdxOf(idx) === vIdx }"
                      @click="setVariantIdx(idx, vIdx)"
                    >
                      <v-icon v-if="vIdx === 0" size="12" class="bed-var-star">mdi-star</v-icon>
                      Biến thể {{ vIdx + 1 }}
                      <span v-if="vIdx === 0" class="bed-var-default">mặc định</span>
                    </button>
                    <button class="bed-var-tab bed-var-add" @click="addTextVariant(idx)">
                      <v-icon size="13">mdi-plus</v-icon> Thêm
                    </button>
                    <button class="bed-ai-btn" disabled>
                      <v-icon size="14">mdi-creation</v-icon> AI tạo biến thể
                      <span class="bed-ai-soon">Tuần 2</span>
                    </button>
                  </div>

                  <RichTextEditor
                    :key="`txt-${idx}-${variantIdxOf(idx)}`"
                    :ref="(el: any) => setCardEditor(idx, el)"
                    :model-value="variantTextOf(idx)"
                    :show-toolbar="true"
                    :submit-on-enter="false"
                    placeholder="Em xin chào {gender} {name}..."
                    class="bed-rich"
                    @update:model-value="onComponentRichInput(idx)"
                  />
                  <div class="bed-var-bar">
                    <span class="bed-var-bar-label">
                      <v-icon size="13">mdi-cursor-text</v-icon> Chèn biến cá nhân hoá:
                    </span>
                    <button
                      v-for="v in PERSONALIZE_VARS"
                      :key="v.code"
                      type="button"
                      class="bed-var-chip"
                      :title="`Chèn ${v.code} (${v.label}) tại vị trí con trỏ`"
                      @click="insertVariable(v.code)"
                    >
                      <v-icon size="12">{{ v.icon }}</v-icon>
                      <code>{{ v.code }}</code>
                      <span class="bed-var-chip-label">{{ v.label }}</span>
                    </button>
                  </div>
                  <div class="bed-editor-footer">
                    <span class="bed-hint">
                      <v-icon size="13">mdi-lightbulb-on-outline</v-icon>
                      Bấm chip phía trên để chèn biến vào ngay vị trí đang gõ
                    </span>
                    <span class="bed-char-counter">{{ (variantTextOf(idx) || '').length }} / 1000 ký tự</span>
                  </div>
                </div>

                <!-- Card body: IMAGE / VIDEO / FILE — ô gọn -->
                <div
                  v-else-if="c.kind === 'image' || c.kind === 'video' || c.kind === 'file'"
                  class="bed-stack-body bed-stack-media"
                >
                  <!-- D7: media trong Khối LUÔN từ Kho (có mediaAssetId) — bỏ ô dán URL tay,
                       tránh ảnh ngoài lọt vào automation/broadcast (anh chốt 2026-06-12). -->
                  <div class="bed-media-row">
                    <button class="bed-add-btn" type="button" style="white-space:nowrap;" @click="openMediaPicker(idx)">
                      <v-icon size="14">mdi-image-multiple-outline</v-icon>
                      {{ (c as any).url ? 'Đổi từ Kho' : 'Chọn từ Kho' }}
                    </button>
                    <span v-if="!(c as any).url" class="bed-hint" style="margin-left:8px;">
                      Chọn ảnh/video/file đã có trong Kho phương tiện.
                    </span>
                  </div>
                  <!-- D5: video play được ngay trong editor (controls), ảnh xem trước, file hiện tên. -->
                  <div v-if="(c as any).url" class="bed-media-row">
                    <video
                      v-if="c.kind === 'video'"
                      :src="(c as any).url"
                      controls
                      preload="metadata"
                      style="max-height:120px; max-width:100%; border:1px solid #ddd; border-radius:6px; background:#000;"
                    ></video>
                    <span
                      v-else-if="c.kind === 'file'"
                      class="bed-hint"
                      style="display:inline-flex; align-items:center; gap:6px;"
                    >
                      <v-icon size="16" color="var(--error)">mdi-file-pdf-box</v-icon>
                      {{ (c as any).filename || 'Đã chọn 1 file từ Kho' }}
                    </span>
                    <img v-else :src="(c as any).url" alt="" style="max-height:70px; border:1px solid #ddd; border-radius:6px; object-fit:contain;" />
                  </div>
                  <div v-if="c.kind === 'file'" class="bed-media-row">
                    <label class="bed-field-label">Tên file</label>
                    <input
                      v-model="(c as any).filename"
                      type="text"
                      class="bed-input"
                      placeholder="bảng_giá_T6.pdf"
                      @input="markDirty"
                    />
                  </div>
                  <div class="bed-media-row">
                    <label class="bed-field-label">Caption (tuỳ chọn)</label>
                    <input
                      v-model="(c as any).caption"
                      type="text"
                      class="bed-input"
                      @input="markDirty"
                    />
                  </div>
                </div>

                <!-- Card body: ALBUM — D7: chỉ chọn từ Kho (bỏ ô dán URL + "+ Thêm URL").
                     Ảnh album luôn có mediaAssetId, không URL ngoài. -->
                <div v-else-if="c.kind === 'album'" class="bed-stack-body bed-stack-media">
                  <p class="bed-hint bed-hint-block">Album tối đa 10 ảnh — chọn từ Kho phương tiện.</p>
                  <div class="bed-album-thumbs">
                    <template v-for="(item, i) in ((c as any).items || []) as Array<{url: string}>" :key="i as number">
                      <div v-if="item.url" class="bed-album-thumb">
                        <img :src="item.url" alt="" />
                        <button class="bed-album-thumb-x" type="button" title="Bỏ ảnh" @click="removeAlbumItemOf(idx, i as number)">
                          <v-icon size="12">mdi-close</v-icon>
                        </button>
                      </div>
                    </template>
                  </div>
                  <div style="display:flex; gap:6px;">
                    <button class="bed-add-btn" type="button" @click="openMediaPicker(idx, true)"><v-icon size="13">mdi-image-multiple-outline</v-icon> Chọn từ Kho</button>
                  </div>
                </div>
              </div>

              <div v-if="components.length === 0" class="bed-empty-editor bed-stack-empty">
                <v-icon size="40" color="var(--ink-4)">mdi-layers-outline</v-icon>
                <div>Chưa có thành phần. Bấm "+ Thêm thành phần" để bắt đầu.</div>
              </div>

              <!-- Nút thêm thành phần cuối stack -->
              <div class="bed-stack-add-wrap">
                <button class="bed-stack-add-btn" @click.stop="stackAddMenu = !stackAddMenu">
                  <v-icon size="16">mdi-plus</v-icon> Thêm thành phần
                  <v-icon size="14">mdi-chevron-down</v-icon>
                </button>
                <div v-if="stackAddMenu" class="bed-stack-add-menu" @click.stop>
                  <button @click="addComponent('text'); stackAddMenu = false"><v-icon size="15">mdi-format-text</v-icon> Tin text</button>
                  <button @click="addComponent('image'); stackAddMenu = false"><v-icon size="15">mdi-image-outline</v-icon> Hình</button>
                  <button @click="addComponent('album'); stackAddMenu = false"><v-icon size="15">mdi-image-multiple-outline</v-icon> Album</button>
                  <button @click="addComponent('file'); stackAddMenu = false"><v-icon size="15">mdi-paperclip</v-icon> File</button>
                  <button @click="addComponent('video'); stackAddMenu = false"><v-icon size="15">mdi-video-outline</v-icon> Video</button>
                </div>
              </div>
            </div>
          </template>

          <!-- request_friend editor -->
          <template v-else-if="draft.actionType === 'request_friend'">
            <div class="bed-toggle-row">
              <span class="bed-toggle-label">Lời chào kết bạn (biến thể {{ activeGreetingIdx + 1 }}/{{ greetingVariants.length }})</span>
            </div>
            <div class="bed-editor-body">
              <RichTextEditor
                :key="`grt-${activeGreetingIdx}`"
                ref="greetingEditorRef"
                v-model="activeGreetingText"
                :show-toolbar="true"
                :submit-on-enter="false"
                placeholder="Chào anh/chị, em là Thành bên Sunshine..."
                class="bed-rich"
                @update:model-value="onGreetingInput"
              />
              <div class="bed-var-bar">
                <span class="bed-var-bar-label">
                  <v-icon size="13">mdi-cursor-text</v-icon> Chèn biến cá nhân hoá:
                </span>
                <button
                  v-for="v in PERSONALIZE_VARS"
                  :key="v.code"
                  type="button"
                  class="bed-var-chip"
                  :title="`Chèn ${v.code} (${v.label}) tại vị trí con trỏ`"
                  @click="insertVariable(v.code)"
                >
                  <v-icon size="12">{{ v.icon }}</v-icon>
                  <code>{{ v.code }}</code>
                  <span class="bed-var-chip-label">{{ v.label }}</span>
                </button>
              </div>
              <div class="bed-editor-footer">
                <span class="bed-hint">
                  <v-icon size="13">mdi-lightbulb-on-outline</v-icon>
                  Bấm chip phía trên để chèn biến vào ngay vị trí đang gõ
                </span>
                <span class="bed-char-counter">{{ activeGreetingText.length }} / 500 ký tự (Zalo cap)</span>
              </div>
            </div>
          </template>

          <!-- update_status editor -->
          <template v-else-if="draft.actionType === 'update_status'">
            <div class="bed-editor-body bed-status-body">
              <label class="bed-field-label">Trạng thái mới</label>
              <select v-model="statusId" class="bed-input" @change="markDirty">
                <option value="">— Chọn trạng thái —</option>
                <option v-for="s in statusItems" :key="s.id" :value="s.id">{{ s.name }}</option>
              </select>
              <p class="bed-hint bed-hint-block">
                Khi Khối này chạy trong sequence/trigger, hệ thống sẽ đổi giai đoạn KH sang trạng thái đã chọn.
              </p>
            </div>
          </template>

          <div v-else class="bed-empty-editor">
            <v-icon size="40" color="var(--ink-4)">mdi-gesture-tap</v-icon>
            <div>Chọn 1 thành phần bên trái để chỉnh sửa</div>
          </div>
        </section>

        <!-- Col 3: Zalo Preview LIVE -->
        <aside class="bed-col3">
          <div class="bed-col3-head">
            <span><v-icon size="15">mdi-cellphone</v-icon> Xem trước trên Zalo</span>
            <span class="bed-live"><span class="bed-live-dot"></span> LIVE</span>
          </div>
          <div class="bed-zalo-window">
            <div class="bed-zalo-time-label">
              <v-icon size="12">mdi-cellphone</v-icon> KH sẽ thấy thế này trên Zalo · {{ currentHHmm }}
            </div>
            <template v-if="draft.actionType === 'send_message'">
              <template v-for="(c, idx) in components" :key="idx">
                <div v-if="c.kind === 'text'" class="bed-zalo-bubble out" v-html="previewVariantHtml(c, idx)"></div>
                <!-- previewVariantHtml hiển thị biến thể ĐANG chọn của component đó (sync card) -->
                <div v-else-if="c.kind === 'image'" class="bed-zalo-image">
                  <img v-if="(c as any).url" :src="(c as any).url" alt="" />
                </div>
                <div v-else-if="c.kind === 'album'" class="bed-zalo-album">
                  <div v-for="(item, i) in ((c as any).items || []).slice(0, 4)" :key="i" class="bed-zalo-album-item">
                    <img v-if="(item as any).url" :src="(item as any).url" alt="" />
                  </div>
                </div>
                <div v-else-if="c.kind === 'file'" class="bed-zalo-file">
                  <v-icon size="16" color="var(--error)">mdi-file-pdf-box</v-icon>
                  {{ (c as any).filename || 'file.pdf' }}
                </div>
                <!-- D5: video play được ngay trong preview (sale bấm play xem). Fallback placeholder khi chưa chọn. -->
                <video
                  v-else-if="c.kind === 'video' && (c as any).url"
                  :src="(c as any).url"
                  controls
                  preload="metadata"
                  class="bed-zalo-video-player"
                ></video>
                <div v-else-if="c.kind === 'video'" class="bed-zalo-video">
                  <v-icon size="18" color="#fff">mdi-play-circle-outline</v-icon> Video
                </div>
                <div class="bed-zalo-time">
                  {{ currentHHmm }} · <span class="bed-zalo-tin">Tin {{ idx + 1 }}/{{ components.length }}</span>
                </div>
              </template>
              <div v-if="components.length === 0" class="bed-zalo-empty">
                Thêm thành phần bên trái để xem KH thấy gì
              </div>
            </template>

            <template v-else-if="draft.actionType === 'request_friend'">
              <div class="bed-zalo-bubble out" v-html="greetingPreviewHtml"></div>
              <div class="bed-zalo-time">{{ currentHHmm }} · Lời mời kết bạn</div>
            </template>

            <template v-else-if="draft.actionType === 'update_status'">
              <div class="bed-zalo-system">
                <v-icon size="14">mdi-tag-outline</v-icon>
                KH này sẽ tự đổi giai đoạn sang
                <b>{{ statusItems.find(s => s.id === statusId)?.name || '(chưa chọn)' }}</b>
              </div>
            </template>
          </div>
          <div class="bed-col3-foot">
            <v-icon size="13">mdi-dice-multiple-outline</v-icon>
            Variant random khi gửi:
            <b v-if="draft.actionType === 'send_message' && activeComponent?.kind === 'text'">
              {{ variantIdxOf(activeComponentIdx) + 1 }}/{{ textVariantsForActive.length }}
            </b>
            <b v-else-if="draft.actionType === 'request_friend'">
              {{ activeGreetingIdx + 1 }}/{{ greetingVariants.length }}
            </b>
            <b v-else>—</b>
          </div>
        </aside>
      </div>

      <div v-if="error" class="bed-error">{{ error }}</div>
    </div>

    <!-- Media GĐ3: dialog chọn ảnh từ Kho phương tiện.
         D3-filter: public-only — Khối chỉ gắn media CÔNG KHAI (không lộ ảnh nick Riêng tư ra broadcast). -->
    <MediaPickerDialog
      v-if="mediaPickerFor"
      :multiple="mediaPickerFor.album"
      :kind="mediaPickerFor.kind"
      :public-only="true"
      @pick="onMediaPicked"
      @close="mediaPickerFor = null"
    />
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import { blocksApi } from '@/api/automation';
import { type Block, type BlockFolder, type BlockActionType } from '@/api/automation/types';
import { TEMPLATE_VARIABLES } from '@/constants/template-variables';
import RichTextEditor from '@/components/chat/rich-text-editor.vue';
import MediaPickerDialog from '@/components/media/MediaPickerDialog.vue';
import { useAuthStore } from '@/stores/auth';
import { useConfirm } from '@/composables/use-confirm';

const { confirm } = useConfirm();

// ── Zalo rich-format render (COPY từ chat/special-message-renderer.vue 2026-06-06) ──
// Render {text, styles[]} → escaped HTML cho bubble preview col 3.
// Giữ COPY (không import) để tránh đụng file Chat. st: b/i/u/s/c_RRGGBB/f_NN/lst_*.
interface ZaloStyle { st: string; start: number; len: number }
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function openTagFor(st: string): string {
  if (st === 'b') return '<strong>';
  if (st === 'i') return '<em>';
  if (st === 'u') return '<u>';
  if (st === 's') return '<s>';
  if (st.startsWith('c_')) return `<span style="color:#${st.slice(2)}">`;
  if (st.startsWith('f_')) return `<span style="font-size:${st.slice(2)}px">`;
  if (st.startsWith('s_')) return `<span style="font-size:${st.slice(2)}px">`;
  return '';
}
function closeTagFor(st: string): string {
  if (st === 'b') return '</strong>';
  if (st === 'i') return '</em>';
  if (st === 'u') return '</u>';
  if (st === 's') return '</s>';
  if (st.startsWith('c_') || st.startsWith('f_') || st.startsWith('s_')) return '</span>';
  return '';
}
function applyRichFormat(text: string, sList: ZaloStyle[]): string {
  if (!text) return '';
  const len = text.length;
  const activePerChar: string[][] = Array.from({ length: len }, () => []);
  for (const m of sList) {
    const start = Math.max(0, m.start | 0);
    const end = Math.min(len, start + (m.len | 0));
    for (let i = start; i < end; i++) activePerChar[i].push(m.st);
  }
  let out = '';
  let prevKey = '';
  function emitOpen(keys: string[]) { return keys.map(openTagFor).filter(Boolean).join(''); }
  function emitClose(keys: string[]) { return [...keys].reverse().map(closeTagFor).filter(Boolean).join(''); }
  let prevList: string[] = [];
  for (let i = 0; i < len; i++) {
    const cur = activePerChar[i].slice().sort();
    const curKey = cur.join(',');
    if (curKey !== prevKey) {
      out += emitClose(prevList);
      out += emitOpen(cur);
      prevList = cur;
      prevKey = curKey;
    }
    const ch = text[i];
    if (ch === '\n') out += '<br>';
    else if (ch === '\r') { /* ignore */ }
    else out += escapeHtml(ch);
  }
  out += emitClose(prevList);
  return out;
}

type RichEditorExposed = {
  getRichPayload: () => { text: string; styles: ZaloStyle[] };
  applyRichPayload: (p: { text: string; styles?: ZaloStyle[] }) => void;
  insertText: (text: string) => void;
  focus: (position?: 'start' | 'end' | number) => void;
};

// Biến cá nhân hoá — DÙNG CHUNG danh sách 8 biến (anh chốt 2026-06-15), KHỚP backend
// render-template.ts. Trước đây định nghĩa 3 biến cứng tại đây → gom về template-variables.ts.
const PERSONALIZE_VARS = TEMPLATE_VARIABLES;

const props = defineProps<{
  modelValue: boolean;
  block: Block | null;
  folders: BlockFolder[];
  statusItems: Array<{ id: string; name: string }>;
}>();
const emit = defineEmits<{
  'update:modelValue': [open: boolean];
  saved: [block: Block];
  // Báo parent (BlocksView) reload danh sách thư mục sau khi tạo inline.
  'folders-changed': [newFolderId: string];
}>();

interface Draft {
  name: string;
  actionType: BlockActionType;
  folderId: string | null;
  tagIds: string[];
}
interface TextVariant { text: string; styles?: ZaloStyle[] }
interface TextComponent {
  kind: 'text';
  defaultVariant: TextVariant;
  variants?: TextVariant[];
}
interface GreetingVariant { text: string; styles?: ZaloStyle[] }
interface ImageComponent { kind: 'image'; url: string; caption?: string }
interface AlbumComponent { kind: 'album'; items: Array<{ url: string; caption?: string }> }
interface FileComponent { kind: 'file'; url: string; filename: string; sizeBytes?: number; mimeType?: string }
interface VideoComponent { kind: 'video'; url: string; thumbnailUrl?: string; durationSec?: number; caption?: string }
type Component = TextComponent | ImageComponent | AlbumComponent | FileComponent | VideoComponent;

const draft = ref<Draft>({ name: '', actionType: 'send_message', folderId: null, tagIds: [] });
const components = ref<Component[]>([]);
const greetingVariants = ref<GreetingVariant[]>([{ text: '', styles: [] }]);
const statusId = ref<string>('');

const activeComponentIdx = ref<number>(0);

// YC2 (anh chốt 2026-06-16): click thành phần ở Col1 → Col2 tự CUỘN tới card đó để edit.
// Lưu ref từng card theo index; khi activeComponentIdx đổi thì scrollIntoView card tương ứng.
const stackCardEls = ref<Record<number, HTMLElement | null>>({});
function setStackCardRef(idx: number, el: any) { stackCardEls.value[idx] = (el as HTMLElement) ?? null; }
watch(activeComponentIdx, (idx) => {
  nextTick(() => {
    // block:'nearest' → chỉ cuộn trong .bed-stack-scroll, không giật cả trang.
    stackCardEls.value[idx]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
});

// Biến thể đang chọn PER-COMPONENT (anh chốt 2026-06-06: mỗi text card có tab biến thể riêng).
// key = index component trong components[], value = index biến thể đang active (0 = defaultVariant).
const activeVariantIdxByComp = ref<Record<number, number>>({});
const activeGreetingIdx = ref<number>(0);
const addComponentMenu = ref<boolean>(false);
const stackAddMenu = ref<boolean>(false);

// Rich editor refs + guard flag (tránh vòng lặp applyRichPayload ↔ update:modelValue)
// Stack card mode: mỗi text card có 1 editor riêng → lưu theo Map index component.
const cardEditors = new Map<number, RichEditorExposed>();
const greetingEditorRef = ref<RichEditorExposed | null>(null);
const applyingRich = ref<boolean>(false); // dùng cho greeting (request_friend) — 1 editor
// Guard PER-COMPONENT cho stack card: nạp nội dung card B không được chặn keystroke card A.
const applyingCardSet = new Set<number>();

// Đọc/ghi biến thể active của 1 component (default 0).
function variantIdxOf(compIdx: number): number {
  return activeVariantIdxByComp.value[compIdx] ?? 0;
}
function setVariantIdx(compIdx: number, vIdx: number) {
  activeVariantIdxByComp.value = { ...activeVariantIdxByComp.value, [compIdx]: vIdx };
  activeComponentIdx.value = compIdx;
}
// Danh sách biến thể (defaultVariant + variants[]) của 1 text component.
function textVariantsOf(c: Component): TextVariant[] {
  if (c.kind !== 'text') return [];
  const tc = c as TextComponent;
  return [tc.defaultVariant, ...(tc.variants || [])];
}
// Text của biến thể đang chọn của component compIdx (cho :model-value + char counter).
function variantTextOf(compIdx: number): string {
  const c = components.value[compIdx];
  if (!c || c.kind !== 'text') return '';
  return textVariantsOf(c)[variantIdxOf(compIdx)]?.text ?? '';
}
// Trả biến thể object đang active của component compIdx (auto-tạo nếu thiếu).
function variantObjOf(compIdx: number): TextVariant | null {
  const c = components.value[compIdx];
  if (!c || c.kind !== 'text') return null;
  const tc = c as TextComponent;
  const vIdx = variantIdxOf(compIdx);
  if (vIdx === 0) return tc.defaultVariant;
  if (!tc.variants) tc.variants = [];
  const i = vIdx - 1;
  if (!tc.variants[i]) tc.variants[i] = { text: '', styles: [] };
  return tc.variants[i];
}

// Function template ref: Vue gọi LẠI mỗi lần re-render (kể cả khi đang gõ) → nếu cứ
// applyRichPayload mỗi lần sẽ setContent đè lên nội dung đang gõ → con trỏ reset/loạn,
// nhiều editor giành nhau. Fix 2026-06-08: CHỈ nạp 1 lần khi đúng instance editor mới
// mount (so sánh identity). :key đổi theo (compIdx+variantIdx) → đổi biến thể = instance
// mới = nạp lại đúng. Cùng instance (re-render do gõ) → bỏ qua, giữ nguyên con trỏ.
function setCardEditor(compIdx: number, el: RichEditorExposed | null) {
  if (!el) { cardEditors.delete(compIdx); return; }
  if (cardEditors.get(compIdx) === el) return; // đã nạp cho instance này rồi → KHÔNG đụng nữa
  cardEditors.set(compIdx, el);
  const variant = variantObjOf(compIdx);
  if (!variant) return;
  void nextTick(() => {
    applyingCardSet.add(compIdx);
    el.applyRichPayload({ text: variant.text || '', styles: variant.styles || [] });
    void nextTick(() => { applyingCardSet.delete(compIdx); });
  });
}

// Mỗi keystroke trong card text → đọc payload từ ĐÚNG editor đó → lưu vào ĐÚNG biến thể.
function onComponentRichInput(compIdx: number) {
  if (applyingCardSet.has(compIdx)) return; // bỏ qua update do applyRichPayload card NÀY phát ra
  const ed = cardEditors.get(compIdx);
  const variant = variantObjOf(compIdx);
  if (!ed || !variant) return;
  const payload = ed.getRichPayload();
  variant.text = payload.text;
  variant.styles = payload.styles || [];
  markDirty();
}

// Chèn biến cá nhân hoá ({gender}/{name}/{sale}) vào ĐÚNG vị trí con trỏ đang nhập.
// send_message → editor card đang active; request_friend → editor greeting.
// insertText của Tiptap chèn tại selection hiện tại rồi giữ focus → đúng ý anh chốt 2026-06-08.
function insertVariable(code: string) {
  if (draft.value.actionType === 'request_friend') {
    const ed = greetingEditorRef.value;
    if (!ed) return;
    ed.insertText(code);
    onGreetingInput();
    return;
  }
  // send_message: chèn vào card text đang active. Nếu card active không phải text
  // (vd đang chọn card hình) thì chèn vào text card đầu tiên cho an toàn.
  let compIdx = activeComponentIdx.value;
  if (components.value[compIdx]?.kind !== 'text') {
    compIdx = components.value.findIndex((c) => c.kind === 'text');
  }
  if (compIdx < 0) return;
  activeComponentIdx.value = compIdx;
  const ed = cardEditors.get(compIdx);
  if (!ed) return;
  ed.insertText(code);
  onComponentRichInput(compIdx);
}

const saving = ref(false);
const lastSavedAt = ref<Date | null>(null);
const error = ref<string>('');
const isDirty = ref<boolean>(false);

const isEdit = computed(() => props.block !== null);

// RBAC 2026-06-09 — Sale chỉ XEM Khối (mở từ list để dùng), KHÔNG lưu được.
// Lưu được khi: sửa Khối có sẵn + có block.edit, HOẶC tạo mới + có block.create.
const auth = useAuthStore();
const canSave = computed(() =>
  isEdit.value ? auth.canAccess('block', 'edit') : auth.canAccess('block', 'create'),
);

const activeComponent = computed<Component | null>(() => {
  if (draft.value.actionType !== 'send_message') return null;
  return components.value[activeComponentIdx.value] ?? null;
});

// Số biến thể của component đang active — cho footer col3 "Variant random khi gửi".
const textVariantsForActive = computed(() => {
  if (!activeComponent.value || activeComponent.value.kind !== 'text') return [];
  return textVariantsOf(activeComponent.value);
});

// ── Greeting (request_friend) — object {text, styles} ──────────────────────
function greetingText(g: GreetingVariant | string): string {
  return typeof g === 'string' ? g : (g?.text || '');
}
const activeGreetingText = computed<string>({
  get: () => greetingVariants.value[activeGreetingIdx.value]?.text ?? '',
  set: (v) => {
    const g = greetingVariants.value[activeGreetingIdx.value];
    if (g) g.text = v;
  },
});
function onGreetingInput() {
  if (applyingRich.value) return;
  const payload = greetingEditorRef.value?.getRichPayload();
  if (!payload) return;
  const g = greetingVariants.value[activeGreetingIdx.value];
  if (!g) return;
  g.text = payload.text;
  g.styles = payload.styles || [];
  markDirty();
}
const greetingPreviewHtml = computed(() => {
  const g = greetingVariants.value[activeGreetingIdx.value];
  const text = g?.text || '';
  if (!text) return escapeHtml('Lời chào kết bạn...');
  return applyRichFormat(text, g?.styles || []);
});

const selectedFolderInfo = computed(() => props.folders.find((f) => f.id === draft.value.folderId));

const actionPillLabel = computed(() => {
  if (draft.value.actionType === 'send_message') return 'Gửi tin nhắn';
  if (draft.value.actionType === 'request_friend') return 'Mời kết bạn';
  if (draft.value.actionType === 'update_status') return 'Đổi trạng thái';
  return draft.value.actionType;
});
const actionPillIcon = computed(() => {
  if (draft.value.actionType === 'send_message') return 'mdi-send-outline';
  if (draft.value.actionType === 'request_friend') return 'mdi-account-plus-outline';
  if (draft.value.actionType === 'update_status') return 'mdi-tag-outline';
  return 'mdi-cog-outline';
});

function componentIcon(k: string): string {
  if (k === 'text') return 'mdi-format-text';
  if (k === 'image') return 'mdi-image-outline';
  if (k === 'album') return 'mdi-image-multiple-outline';
  if (k === 'file') return 'mdi-paperclip';
  if (k === 'video') return 'mdi-video-outline';
  return 'mdi-help-circle-outline';
}
// Tên loại thuần (cho header card stack — KHÔNG cắt theo nội dung như componentLabel).
function componentTypeLabel(k: string): string {
  if (k === 'text') return 'Tin nhắn';
  if (k === 'image') return 'Hình ảnh';
  if (k === 'album') return 'Album ảnh';
  if (k === 'file') return 'File đính kèm';
  if (k === 'video') return 'Video';
  return 'Thành phần';
}
function componentLabel(c: Component): string {
  if (c.kind === 'text') return ((c as TextComponent).defaultVariant.text || '').slice(0, 28).trim() || 'Tin text';
  if (c.kind === 'image') return (c as ImageComponent).caption?.slice(0, 28) || 'Hình ảnh';
  if (c.kind === 'album') return `Album ${(c as AlbumComponent).items?.length || 0} hình`;
  if (c.kind === 'file') return (c as FileComponent).filename || 'File';
  if (c.kind === 'video') return (c as VideoComponent).caption?.slice(0, 28) || 'Video';
  return 'Thành phần';
}
function componentMeta(c: Component): string {
  if (c.kind === 'text') {
    const count = 1 + ((c as TextComponent).variants?.length || 0);
    return `${count} biến thể`;
  }
  if (c.kind === 'image') return 'URL ảnh';
  if (c.kind === 'album') return `${(c as AlbumComponent).items?.length || 0}/10 ảnh`;
  if (c.kind === 'file') return 'File đính kèm';
  if (c.kind === 'video') return 'Video URL';
  return '';
}

const currentHHmm = computed(() => {
  const d = new Date();
  return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' });
});
const lastSavedHint = computed(() => {
  if (!lastSavedAt.value) return '';
  const sec = Math.floor((Date.now() - lastSavedAt.value.getTime()) / 1000);
  if (sec < 60) return `${sec} giây trước`;
  return `${Math.floor(sec / 60)} phút trước`;
});

// Render bubble preview với FULL format Zalo (bold/màu/cỡ/xuống dòng) như UI Chat.
// Show variant 1 (default) — variants khác sẽ random khi gửi thật.
function previewVariantHtml(c: Component, idx: number): string {
  if (c.kind !== 'text') return '';
  // Hiển thị biến thể ĐANG chọn của component đó → sync với tab biến thể trên card.
  const v = textVariantsOf(c)[variantIdxOf(idx)] ?? (c as TextComponent).defaultVariant;
  const text = v?.text || '';
  if (!text) return escapeHtml('(chưa có nội dung)');
  return applyRichFormat(text, v?.styles || []);
}

// ─── Component CRUD ──────────────────────────────────────────────────────
function addComponent(kind: Component['kind']) {
  addComponentMenu.value = false;
  let newC: Component;
  if (kind === 'text') newC = { kind: 'text', defaultVariant: { text: '', styles: [] }, variants: [] };
  else if (kind === 'image') newC = { kind: 'image', url: '', caption: '' };
  else if (kind === 'album') newC = { kind: 'album', items: [] }; // D7: ảnh thêm qua Kho, không tạo item rỗng
  else if (kind === 'file') newC = { kind: 'file', url: '', filename: '' };
  else newC = { kind: 'video', url: '' };
  components.value.push(newC);
  const newIdx = components.value.length - 1;
  activeComponentIdx.value = newIdx;
  activeVariantIdxByComp.value = { ...activeVariantIdxByComp.value, [newIdx]: 0 };
  markDirty();
}
async function removeComponent(idx: number) {
  if (!(await confirm({ title: 'Xoá thành phần này?', message: 'Thành phần sẽ bị gỡ khỏi khối.', tone: 'danger', confirmText: 'Xoá', cancelText: 'Hủy' }))) return;
  components.value.splice(idx, 1);
  // Dồn lại map biến thể active theo index mới (component sau idx tụt 1 bậc).
  const next: Record<number, number> = {};
  for (const [k, v] of Object.entries(activeVariantIdxByComp.value)) {
    const ki = Number(k);
    if (ki < idx) next[ki] = v;
    else if (ki > idx) next[ki - 1] = v;
  }
  activeVariantIdxByComp.value = next;
  cardEditors.clear(); // editors remount theo :key index mới
  if (activeComponentIdx.value >= components.value.length) {
    activeComponentIdx.value = Math.max(0, components.value.length - 1);
  }
  markDirty();
}

// Thêm biến thể text cho component compIdx + chuyển active sang biến thể mới (cuối).
function addTextVariant(compIdx: number) {
  const c = components.value[compIdx];
  if (!c || c.kind !== 'text') return;
  const tc = c as TextComponent;
  if (!tc.variants) tc.variants = [];
  tc.variants.push({ text: '', styles: [] });
  setVariantIdx(compIdx, tc.variants.length); // last (0 = default → variants[len-1] = index len)
  markDirty();
}

function addGreeting() { greetingVariants.value.push({ text: '', styles: [] }); activeGreetingIdx.value = greetingVariants.value.length - 1; markDirty(); }
function removeGreeting(idx: number) {
  if (greetingVariants.value.length <= 1) return;
  greetingVariants.value.splice(idx, 1);
  activeGreetingIdx.value = Math.min(activeGreetingIdx.value, greetingVariants.value.length - 1);
  markDirty();
}

// Album thao tác THEO index component (stack card mỗi album độc lập).
// D7: bỏ addAlbumItemOf (ô dán URL tay) — ảnh album giờ chỉ thêm qua Kho (openMediaPicker).
function removeAlbumItemOf(compIdx: number, i: number) {
  const c = components.value[compIdx];
  if (c?.kind !== 'album') return;
  (c as AlbumComponent).items?.splice(i, 1);
  markDirty();
}

// Media GĐ3: chèn ảnh từ Kho phương tiện vào component (thay vì dán URL tay).
// 2026-06-13 (anh báo): picker phải lọc ĐÚNG LOẠI (file→tệp, video→video, không phải toàn ảnh)
// + ảnh đơn cho chọn NHIỀU → tự gộp thành album. mediaPickerFor giữ kind của kho cần lọc +
// album=true khi cho chọn nhiều (component album HOẶC component ảnh muốn gộp album).
const mediaPickerFor = ref<{ compIdx: number; album: boolean; kind: string } | null>(null);
function openMediaPicker(compIdx: number, album = false) {
  const c = components.value[compIdx] as any;
  // kind kho: album/image → 'image'; video → 'video'; file → 'file'. Ảnh đơn cũng cho chọn nhiều
  // (multiple) để gộp album, nên album=true cho cả image lẫn album.
  const kind = c?.kind === 'video' ? 'video' : c?.kind === 'file' ? 'file' : 'image';
  const allowMulti = album || c?.kind === 'image' || c?.kind === 'album';
  mediaPickerFor.value = { compIdx, album: allowMulti, kind };
}
function onMediaPicked(assets: Array<{ id: string; url: string | null; name: string; sizeBytes?: number | null }>) {
  const target = mediaPickerFor.value;
  if (!target) return;
  const c = components.value[target.compIdx] as any;
  if (!c) return;
  const valid = assets.filter((a) => a.url);

  if (c.kind === 'album') {
    if (!c.items) c.items = [];
    for (const a of valid) {
      if (c.items.length < 10) c.items.push({ url: a.url, mediaAssetId: a.id });
    }
  } else if (c.kind === 'image' && valid.length > 1) {
    // ẢNH ĐƠN + chọn NHIỀU → TỰ CHUYỂN component sang ALBUM (anh muốn chèn nhiều ảnh = 1 album).
    components.value[target.compIdx] = {
      kind: 'album',
      items: valid.slice(0, 10).map((a) => ({ url: a.url as string, mediaAssetId: a.id })),
    } as any;
  } else if (c.kind === 'file' && valid[0]?.url) {
    // FILE: lấy thêm TÊN + dung lượng từ kho (anh báo CRM hiện file trống tên/0KB do thiếu).
    const a = valid[0];
    c.url = a.url;
    c.mediaAssetId = a.id;
    c.filename = a.name || c.filename || 'tệp';
    if (a.sizeBytes != null) c.sizeBytes = a.sizeBytes;
  } else if (valid[0]?.url) {
    // single (image 1 / video / file): set url + mediaAssetId (engine resolve url; id để đếm dùng).
    c.url = valid[0].url;
    c.mediaAssetId = valid[0].id;
  }
  markDirty();
  mediaPickerFor.value = null;
}

// Tags — nhập inline ngay tại UI (anh chốt 2026-06-08, KHÔNG prompt() Chrome).
const tagInputOpen = ref<boolean>(false);
const tagInputText = ref<string>('');
const tagInputRef = ref<HTMLInputElement | null>(null);
// Blur dùng setTimeout defer: nếu input refocus ngay (gõ phím IME/transient blur) thì huỷ
// commit → tránh bug "gõ 1 ký tự đã commit + đóng ô" do blur quá nhạy. id=null khi không pending.
let tagBlurTimer: ReturnType<typeof setTimeout> | null = null;

function clearTagBlurTimer() {
  if (tagBlurTimer !== null) { clearTimeout(tagBlurTimer); tagBlurTimer = null; }
}
function openTagInput() {
  clearTagBlurTimer();
  tagInputOpen.value = true;
  tagInputText.value = '';
  void nextTick(() => tagInputRef.value?.focus());
}
function cancelTagInput() {
  clearTagBlurTimer();
  tagInputOpen.value = false;
  tagInputText.value = '';
}
// Enter: lưu tag rồi giữ ô mở để gõ tiếp tag kế (gõ nhanh nhiều tag).
function commitTagAndContinue() {
  clearTagBlurTimer();
  const clean = tagInputText.value.trim().replace(/^#+/, '').trim(); // bỏ # đầu nếu user tự gõ
  if (clean) {
    const tag = `#${clean}`;
    if (!draft.value.tagIds.includes(tag)) {
      draft.value.tagIds.push(tag);
      markDirty();
    }
  }
  tagInputText.value = '';
  void nextTick(() => tagInputRef.value?.focus());
}
// Blur: defer 150ms — nếu input lấy lại focus (transient blur khi gõ) thì huỷ. Hết thời gian
// mà vẫn mất focus thật → lưu phần đã gõ (nếu có) rồi đóng ô.
function onTagBlur() {
  clearTagBlurTimer();
  tagBlurTimer = setTimeout(() => {
    tagBlurTimer = null;
    if (document.activeElement === tagInputRef.value) return; // đã refocus → bỏ qua
    const clean = tagInputText.value.trim().replace(/^#+/, '').trim();
    if (clean) {
      const tag = `#${clean}`;
      if (!draft.value.tagIds.includes(tag)) {
        draft.value.tagIds.push(tag);
        markDirty();
      }
    }
    tagInputText.value = '';
    tagInputOpen.value = false;
  }, 150);
}
function removeTag(tag: string) {
  draft.value.tagIds = draft.value.tagIds.filter((t) => t !== tag);
  markDirty();
}

// ── Tạo thư mục inline (anh chốt 2026-06-08: tạo được ngay tại UI, không chỉ chọn) ──
const folderCreateOpen = ref<boolean>(false);
const folderCreateName = ref<string>('');
const folderCreateVis = ref<'public' | 'private'>('public');
const folderSaving = ref<boolean>(false);
const folderNameRef = ref<HTMLInputElement | null>(null);

function openFolderCreate() {
  folderCreateOpen.value = true;
  folderCreateName.value = '';
  folderCreateVis.value = 'public';
  void nextTick(() => folderNameRef.value?.focus());
}
function cancelFolderCreate() {
  folderCreateOpen.value = false;
  folderCreateName.value = '';
}
async function commitFolderCreate() {
  const name = folderCreateName.value.trim();
  if (!name || folderSaving.value) return;
  folderSaving.value = true;
  try {
    const folder = await blocksApi.createFolder({ name, visibility: folderCreateVis.value });
    // Chọn luôn thư mục vừa tạo cho Khối đang soạn + báo parent reload list.
    draft.value.folderId = folder.id;
    markDirty();
    emit('folders-changed', folder.id);
    folderCreateOpen.value = false;
    folderCreateName.value = '';
  } catch (err: any) {
    error.value = err?.response?.data?.detail || err?.response?.data?.error || err?.message || 'Lỗi tạo thư mục';
  } finally {
    folderSaving.value = false;
  }
}

function markDirty() { isDirty.value = true; }

// ── Nạp format đã lưu vào RichTextEditor greeting khi ĐỔI biến thể ──────────
// Stack card text: việc nạp {text, styles} do setCardEditor() lo lúc editor MOUNT
// (đổi biến thể = remount qua :key → setCardEditor chạy lại). KHÔNG cần watcher ở đây.
// Greeting (request_friend) vẫn dùng 1 editor cố định → cần load thủ công.
async function loadActiveGreetingIntoEditor() {
  await nextTick();
  const g = greetingVariants.value[activeGreetingIdx.value];
  if (!g || !greetingEditorRef.value) return;
  applyingRich.value = true;
  greetingEditorRef.value.applyRichPayload({ text: g.text || '', styles: g.styles || [] });
  await nextTick();
  applyingRich.value = false;
}

watch(activeGreetingIdx, () => {
  if (draft.value.actionType === 'request_friend') void loadActiveGreetingIntoEditor();
});

// Watch openness to reset state
watch(() => props.modelValue, (open) => {
  if (!open) return;
  error.value = '';
  isDirty.value = false;
  lastSavedAt.value = null;
  if (props.block) {
    draft.value = {
      name: props.block.name,
      actionType: props.block.actionType,
      folderId: props.block.folderId,
      tagIds: [...(props.block.tagIds || [])],
    };
    const c = props.block.content as any;
    // Components: ưu tiên shape mới {components[]}, fallback shape cũ {textVariants[], attachments[]}
    if (Array.isArray(c?.components)) {
      components.value = normalizeComponents(JSON.parse(JSON.stringify(c.components)));
    } else if (Array.isArray(c?.textVariants) && c.textVariants.length > 0) {
      // Migrate legacy shape sang components[]
      components.value = [{
        kind: 'text',
        defaultVariant: { text: c.textVariants[0], styles: [] },
        variants: c.textVariants.slice(1).map((t: string) => ({ text: t, styles: [] })),
      }];
      if (Array.isArray(c?.attachments)) {
        for (const a of c.attachments) {
          if (a.kind === 'image') components.value.push({ kind: 'image', url: a.url, caption: a.caption });
          else if (a.kind === 'video') components.value.push({ kind: 'video', url: a.url });
          else if (a.kind === 'file') components.value.push({ kind: 'file', url: a.url, filename: a.url.split('/').pop() || 'file' });
        }
      }
    } else {
      components.value = [];
    }
    greetingVariants.value = normalizeGreetings(c?.greetingVariants);
    statusId.value = typeof c?.statusId === 'string' ? c.statusId : '';
    activeComponentIdx.value = 0;
    activeVariantIdxByComp.value = {};
    activeGreetingIdx.value = 0;
  } else {
    draft.value = { name: '', actionType: 'send_message', folderId: null, tagIds: [] };
    components.value = [{ kind: 'text', defaultVariant: { text: '', styles: [] }, variants: [] }];
    greetingVariants.value = [{ text: '', styles: [] }];
    statusId.value = '';
    activeComponentIdx.value = 0;
    activeVariantIdxByComp.value = {};
    activeGreetingIdx.value = 0;
  }
  cardEditors.clear(); // editor cũ remount → setCardEditor nạp lại {text,styles} từng card.
  stackAddMenu.value = false;
  // Reset UI nhập inline (tag + tạo thư mục) mỗi lần mở lại dialog.
  clearTagBlurTimer();
  tagInputOpen.value = false;
  tagInputText.value = '';
  folderCreateOpen.value = false;
  folderCreateName.value = '';
  // Text card: setCardEditor() tự applyRichPayload lúc mount (block cũ có sẵn styles).
  if (draft.value.actionType === 'request_friend') void loadActiveGreetingIntoEditor();
});

// Chuẩn hoá: đảm bảo mỗi text variant là {text, styles[]} (block cũ có thể thiếu styles).
function normalizeComponents(list: Component[]): Component[] {
  for (const c of list) {
    if (c.kind === 'text') {
      const tc = c as TextComponent;
      if (!tc.defaultVariant) tc.defaultVariant = { text: '', styles: [] };
      if (!Array.isArray(tc.defaultVariant.styles)) tc.defaultVariant.styles = [];
      tc.variants = (tc.variants || []).map((v) => ({ text: v.text || '', styles: Array.isArray(v.styles) ? v.styles : [] }));
    }
  }
  return list;
}
// greetingVariants có thể là string[] (cũ) hoặc {text,styles}[] (mới).
function normalizeGreetings(raw: unknown): GreetingVariant[] {
  if (!Array.isArray(raw) || raw.length === 0) return [{ text: '', styles: [] }];
  return raw.map((g: any) =>
    typeof g === 'string'
      ? { text: g, styles: [] }
      : { text: g?.text || '', styles: Array.isArray(g?.styles) ? g.styles : [] },
  );
}

function buildContent(): Record<string, unknown> {
  if (draft.value.actionType === 'request_friend') {
    // Lời mời kết bạn Zalo KHÔNG hỗ trợ format (sendFriendRequest nhận string thuần).
    // → gửi greetingVariants: string[] (chuẩn BE + engine request-friend).
    return {
      greetingVariants: greetingVariants.value
        .map((g) => g.text)
        .filter((t) => t.trim()),
    };
  }
  if (draft.value.actionType === 'send_message') {
    // Strip empty components
    const cleaned = components.value
      .map((c) => {
        if (c.kind === 'text') {
          const tc = c as TextComponent;
          const variants = (tc.variants || [])
            .filter((v) => v.text.trim())
            .map((v) => ({ text: v.text, styles: v.styles || [] }));
          if (!tc.defaultVariant.text.trim() && variants.length === 0) return null;
          return {
            kind: 'text',
            defaultVariant: { text: tc.defaultVariant.text, styles: tc.defaultVariant.styles || [] },
            variants,
          };
        }
        if ((c as any).url || (c.kind === 'album' && (c as AlbumComponent).items?.length)) return c;
        return null;
      })
      .filter(Boolean);
    return { components: cleaned };
  }
  if (draft.value.actionType === 'update_status') {
    return { statusId: statusId.value };
  }
  return {};
}

async function onSave() {
  error.value = '';
  if (!draft.value.name.trim()) { error.value = 'Tên Khối không được để trống'; return; }
  saving.value = true;
  try {
    const content = buildContent();
    let block: Block;
    if (props.block) {
      block = await blocksApi.updateBlock(props.block.id, {
        name: draft.value.name.trim(),
        folderId: draft.value.folderId,
        content,
        tagIds: draft.value.tagIds,
      });
    } else {
      block = await blocksApi.createBlock({
        name: draft.value.name.trim(),
        actionType: draft.value.actionType,
        folderId: draft.value.folderId,
        content,
        tagIds: draft.value.tagIds,
      });
    }
    lastSavedAt.value = new Date();
    isDirty.value = false;
    emit('saved', block);
  } catch (err: any) {
    error.value = err?.response?.data?.detail || err?.response?.data?.error || err?.message || 'Lỗi không xác định';
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
.bed-wrap {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--surface);
  font-family: var(--font);
  color: var(--ink);
}

/* Topbar */
.bed-topbar {
  background: var(--surface);
  border-bottom: 1px solid var(--line);
  padding: 11px 20px;
  display: flex;
  align-items: center;
  gap: 14px;
  flex-shrink: 0;
}
.bed-back {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--ink-3);
  cursor: pointer;
  font-size: 13px;
  background: transparent;
  border: 0;
  font-family: inherit;
  padding: 6px 10px;
  border-radius: var(--r-xs);
}
.bed-back:hover { background: var(--surface-3); color: var(--ink); }
.bed-name-input {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid transparent;
  border-radius: var(--r-xs);
  background: transparent;
  font-size: 15px;
  font-weight: 600;
  color: var(--ink);
  outline: none;
  max-width: 480px;
  font-family: inherit;
}
.bed-name-input:hover { border-color: var(--line); }
.bed-name-input:focus {
  border-color: var(--brand);
  background: var(--surface);
  box-shadow: 0 0 0 3px var(--brand-soft);
}
.bed-save-status {
  font-size: 11px;
  color: var(--ink-3);
  display: flex;
  align-items: center;
  gap: 4px;
}
.bed-save-status.saved { color: var(--success); }
.bed-actions { display: flex; gap: 8px; margin-left: auto; }

.bed-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: var(--r-sm);
  border: 1px solid var(--line);
  background: var(--surface);
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  font-family: inherit;
  color: var(--ink-2);
}
.bed-btn-primary {
  background: var(--brand);
  border-color: var(--brand);
  color: #fff;
  box-shadow: var(--sh-xs);
}
.bed-btn-primary:hover:not(:disabled) { background: var(--brand-600); }
.bed-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

/* Sub-bar */
.bed-subbar {
  padding: 9px 20px;
  border-bottom: 1px solid var(--line);
  background: var(--surface-2);
  display: flex;
  align-items: center;
  gap: 14px;
  font-size: 12px;
  flex-wrap: wrap;
}
.bed-sub-group { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.bed-sub-label { color: var(--ink-3); font-weight: 600; display: inline-flex; align-items: center; gap: 4px; }
.bed-sub-divider { width: 1px; background: var(--line); height: 18px; }

.bed-folder-select, .bed-action-select {
  padding: 5px 9px;
  border: 1px solid var(--line);
  border-radius: var(--r-xs);
  font-size: 12px;
  font-family: inherit;
  background: var(--surface);
  color: var(--ink);
}
.bed-vis-hint {
  font-size: 11px;
  font-weight: 600;
  color: var(--success);
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.bed-vis-hint.private { color: var(--warning); }

.bed-tag-group { flex: 1; min-width: 0; }
.bed-tag-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: var(--brand-soft);
  color: var(--brand-700);
  border: 1px solid var(--brand-bright);
  padding: 3px 9px;
  border-radius: var(--r-pill);
  font-size: 11px;
  font-weight: 600;
}
.bed-tag-x {
  background: transparent;
  border: 0;
  color: inherit;
  cursor: pointer;
  font-size: 11px;
  padding: 0 2px;
  opacity: 0.6;
  display: inline-flex;
  align-items: center;
}
.bed-tag-x:hover { opacity: 1; }
.bed-tag-add {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: transparent;
  border: 1px dashed var(--line);
  padding: 3px 9px;
  border-radius: var(--r-pill);
  font-size: 11px;
  color: var(--ink-3);
  cursor: pointer;
  font-family: inherit;
}
.bed-tag-add:hover { color: var(--ink); border-color: var(--ink-4); }

/* Inline tag input (2026-06-08) */
.bed-tag-input-wrap {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  background: var(--surface);
  border: 1px solid var(--brand);
  box-shadow: 0 0 0 3px var(--brand-soft);
  border-radius: var(--r-pill);
  padding: 2px 9px;
}
.bed-tag-hash { color: var(--brand-700); font-size: 11px; font-weight: 700; }
.bed-tag-input {
  border: 0;
  outline: none;
  background: transparent;
  font-size: 11px;
  font-family: inherit;
  color: var(--ink);
  width: 96px;
  padding: 1px 0;
}

/* Inline tạo thư mục (2026-06-08) */
.bed-folder-new-btn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  background: transparent;
  border: 1px dashed var(--line);
  padding: 4px 9px;
  border-radius: var(--r-xs);
  font-size: 11px;
  color: var(--brand-700);
  cursor: pointer;
  font-family: inherit;
  font-weight: 600;
}
.bed-folder-new-btn:hover { border-color: var(--brand); background: var(--brand-softer); }
.bed-folder-name-input {
  padding: 5px 9px;
  border: 1px solid var(--brand);
  box-shadow: 0 0 0 3px var(--brand-soft);
  border-radius: var(--r-xs);
  font-size: 12px;
  font-family: inherit;
  background: var(--surface);
  color: var(--ink);
  outline: none;
  width: 170px;
}
.bed-folder-vis-toggle {
  display: inline-flex;
  border: 1px solid var(--line);
  border-radius: var(--r-xs);
  overflow: hidden;
}
.bed-vis-opt {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 5px 9px;
  background: var(--surface);
  border: 0;
  font-size: 11px;
  color: var(--ink-3);
  cursor: pointer;
  font-family: inherit;
}
.bed-vis-opt + .bed-vis-opt { border-left: 1px solid var(--line); }
.bed-vis-opt:hover { background: var(--surface-3); }
.bed-vis-opt.active { background: var(--brand-soft); color: var(--brand-700); font-weight: 600; }
.bed-folder-save {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 5px 11px;
  background: var(--brand);
  border: 0;
  border-radius: var(--r-xs);
  font-size: 11px;
  color: #fff;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
}
.bed-folder-save:hover:not(:disabled) { background: var(--brand-600); }
.bed-folder-save:disabled { opacity: 0.5; cursor: not-allowed; }
.bed-folder-cancel {
  display: inline-flex;
  align-items: center;
  padding: 5px 7px;
  background: transparent;
  border: 1px solid var(--line);
  border-radius: var(--r-xs);
  color: var(--ink-3);
  cursor: pointer;
}
.bed-folder-cancel:hover { color: var(--error); border-color: var(--error); }

.bed-action-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: var(--brand-soft);
  color: var(--brand-700);
  font-size: 11px;
  font-weight: 600;
  padding: 3px 9px;
  border-radius: var(--r-sm);
}

/* Body 3 col */
.bed-body {
  display: flex;
  flex: 1;
  min-height: 0;
}

/* Col 1 — 2026-06-08: 3 cột BẰNG NHAU (anh chốt). flex 1 1 0 = chia đều 1/3. */
.bed-col1 {
  flex: 1 1 0;
  min-width: 0;
  min-height: 0; /* con .bed-comp-list (overflow-y:auto) co lại đúng để cuộn */
  overflow: hidden;
  background: var(--surface-2);
  border-right: 1px solid var(--line);
  display: flex;
  flex-direction: column;
}
.bed-col1-head {
  padding: 12px 14px 8px;
  border-bottom: 1px solid var(--line);
  display: flex;
  justify-content: space-between;
  align-items: center;
  position: relative;
}
.bed-col1-title {
  font-size: 11px;
  font-weight: 700;
  color: var(--ink-4);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.bed-add-btn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 4px 8px;
  border-radius: var(--r-xs);
  background: var(--brand);
  color: #fff;
  border: 0;
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
}
.bed-add-btn:hover { background: var(--brand-600); }
.bed-add-menu {
  position: absolute;
  top: calc(100% - 2px);
  right: 14px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  box-shadow: var(--sh-lg);
  z-index: 10;
  display: flex;
  flex-direction: column;
  padding: 4px;
  min-width: 160px;
}
.bed-add-menu button {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  text-align: left;
  background: transparent;
  border: 0;
  border-radius: var(--r-xs);
  font-size: 12px;
  cursor: pointer;
  font-family: inherit;
  color: var(--ink-2);
}
.bed-add-menu button:hover { background: var(--surface-3); color: var(--ink); }

.bed-comp-list { padding: 8px; overflow-y: auto; flex: 1; }
.bed-comp-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 10px;
  border-radius: var(--r-sm);
  cursor: pointer;
  background: var(--surface);
  border: 1px solid var(--line);
  margin-bottom: 6px;
  transition: all 0.12s;
}
.bed-comp-item:hover { border-color: var(--ink-4); box-shadow: var(--sh-xs); }
.bed-comp-item.active {
  border-color: var(--brand);
  background: var(--brand-softer);
  box-shadow: var(--sh-sm);
}
.bed-comp-drag { color: var(--ink-4); cursor: grab; display: inline-flex; }
.bed-comp-icon { width: 20px; text-align: center; flex-shrink: 0; color: var(--ink-2); display: inline-flex; justify-content: center; }
.bed-comp-item.active .bed-comp-icon { color: var(--brand); }
.bed-comp-info { flex: 1; min-width: 0; }
.bed-comp-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bed-comp-meta { font-size: 10.5px; color: var(--ink-3); margin-top: 1px; }
.bed-comp-item.active .bed-comp-meta { color: var(--brand-700); font-weight: 500; }
.bed-comp-x {
  background: transparent;
  border: 0;
  color: var(--ink-4);
  cursor: pointer;
  padding: 2px 4px;
  display: inline-flex;
}
.bed-comp-x:hover { color: var(--error); }
.bed-comp-empty {
  text-align: center;
  font-size: 11.5px;
  color: var(--ink-4);
  font-style: italic;
  padding: 20px 10px;
}

/* Col 2 — 2026-06-08: 3 cột BẰNG NHAU (anh chốt). flex 1 1 0 = chia đều 1/3. */
.bed-col2 {
  flex: 1 1 0;
  min-width: 0;
  /* 2026-06-08 FIX: min-height:0 + overflow:hidden để con .bed-stack-scroll (flex:1,
     overflow-y:auto) co lại đúng → CUỘN khi nhiều thành phần, không tràn/đè lên nhau. */
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: var(--surface-2);
}

/* ── Stack card (send_message) — block-builder dọc 2026-06-06 ────────────── */
.bed-stack-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 14px 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
.bed-stack-card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  box-shadow: var(--sh-xs);
  cursor: pointer;
  transition: border-color 0.12s, box-shadow 0.12s;
  overflow: hidden;
  /* 2026-06-08 FIX: KHÔNG cho card co lại trong flex column → mỗi card giữ chiều cao
     thật (toolbar + ô soạn + chip), nhiều card thì .bed-stack-scroll CUỘN, không đè/cắt nhau. */
  flex-shrink: 0;
}
.bed-stack-card:hover { border-color: var(--ink-4); }
.bed-stack-card.active {
  border-color: var(--brand);
  box-shadow: 0 0 0 3px var(--brand-soft);
}
.bed-stack-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 12px;
  background: var(--surface-2);
  border-bottom: 1px solid var(--line);
}
.bed-stack-card.active .bed-stack-head { background: var(--brand-softer); }
.bed-stack-num {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--brand);
  color: #fff;
  border-radius: var(--r-xs);
  font-size: 11px;
  font-weight: 700;
  font-family: var(--mono);
  font-variant-numeric: tabular-nums;
}
.bed-stack-icon { color: var(--ink-2); display: inline-flex; flex-shrink: 0; }
.bed-stack-card.active .bed-stack-icon { color: var(--brand); }
.bed-stack-title {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ink);
}
.bed-stack-spacer { flex: 1; }
.bed-stack-drag { color: var(--ink-4); cursor: grab; display: inline-flex; }
.bed-stack-x {
  background: transparent;
  border: 0;
  color: var(--ink-4);
  cursor: pointer;
  padding: 2px 4px;
  display: inline-flex;
  border-radius: var(--r-xs);
}
.bed-stack-x:hover { color: var(--error); background: var(--error-soft); }

/* Body chung */
.bed-stack-body { padding: 12px 14px; display: flex; flex-direction: column; min-width: 0; }
/* Text card CAO — ô soạn min ~160px */
.bed-stack-card.is-text .bed-stack-body { min-height: 0; }
/* Media card GỌN */
.bed-stack-media { gap: 8px; }
.bed-media-row { display: flex; flex-direction: column; gap: 3px; }
.bed-media-row .bed-field-label { margin: 0; }

/* Nút thêm thành phần cuối stack */
.bed-stack-add-wrap { position: relative; align-self: stretch; flex-shrink: 0; }
.bed-stack-add-btn {
  width: 100%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 10px 14px;
  border: 1px dashed var(--ink-4);
  border-radius: var(--r-md);
  background: var(--surface);
  color: var(--brand-700);
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
}
.bed-stack-add-btn:hover { border-color: var(--brand); background: var(--brand-softer); }
.bed-stack-add-menu {
  position: absolute;
  bottom: calc(100% + 4px);
  left: 0;
  right: 0;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  box-shadow: var(--sh-lg);
  z-index: 10;
  display: flex;
  flex-direction: column;
  padding: 4px;
}
.bed-stack-add-menu button {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  text-align: left;
  background: transparent;
  border: 0;
  border-radius: var(--r-xs);
  font-size: 12px;
  cursor: pointer;
  font-family: inherit;
  color: var(--ink-2);
}
.bed-stack-add-menu button:hover { background: var(--surface-3); color: var(--ink); }
.bed-stack-empty { padding: 40px 16px; }

/* Variant bar — bên trong text card (thanh tab nhỏ) */
.bed-variant-bar {
  padding: 0 0 0;
  border-bottom: 1px solid var(--line);
  background: transparent;
  display: flex;
  align-items: flex-end;
  gap: 3px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.bed-var-tab {
  padding: 8px 14px;
  border-radius: var(--r-sm) var(--r-sm) 0 0;
  background: transparent;
  border: 1px solid transparent;
  border-bottom: 0;
  font-size: 12px;
  font-weight: 500;
  color: var(--ink-3);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  position: relative;
  font-family: inherit;
}
.bed-var-tab:hover { background: var(--surface); color: var(--ink); }
.bed-var-tab.active {
  background: var(--surface);
  border-color: var(--line);
  color: var(--ink);
  font-weight: 600;
  margin-bottom: -1px;
}
.bed-var-tab.active::after {
  content: '';
  position: absolute;
  left: 0; right: 0; bottom: -1px;
  height: 2px;
  background: var(--brand);
}
.bed-var-star { color: var(--warning); font-size: 11px; }
.bed-var-default { opacity: 0.6; font-size: 10px; }
.bed-var-add { color: var(--brand); font-weight: 500; }
.bed-ai-btn {
  margin-left: auto;
  margin-bottom: 6px;
  background: var(--surface-3);
  color: var(--ink-3);
  border: 1px solid var(--line);
  padding: 6px 12px;
  border-radius: var(--r-sm);
  font-size: 11.5px;
  font-weight: 600;
  cursor: not-allowed;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-family: inherit;
  opacity: 0.9;
}
.bed-ai-soon {
  background: var(--brand-soft);
  color: var(--brand-700);
  font-size: 9px;
  padding: 1px 5px;
  border-radius: var(--r-sm);
  font-weight: 700;
  margin-left: 2px;
}

.bed-toggle-row {
  padding: 10px 18px;
  border-bottom: 1px solid var(--line);
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--surface);
}
.bed-toggle-label { font-size: 11.5px; color: var(--ink-3); font-weight: 500; }

.bed-editor-body {
  flex: 1;
  padding: 18px 22px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: var(--surface);
}
.bed-status-body { padding: 20px; }
/* RichTextEditor fill the editor area (chiều cao linh hoạt cho col 2) */
.bed-rich {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 220px;
}
.bed-rich :deep(.editor-content) { flex: 1; display: flex; flex-direction: column; min-height: 0; }
.bed-rich :deep(.tiptap-input) { flex: 1; min-height: 180px; max-height: none; }

.bed-editor-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 10px;
  gap: 12px;
  font-size: 11px;
  color: var(--ink-4);
}
.bed-char-counter { font-family: var(--mono); font-variant-numeric: tabular-nums; }
.bed-hint { color: var(--ink-3); display: inline-flex; align-items: center; gap: 4px; }

/* Thanh chip biến cá nhân hoá — bấm chèn {gender}/{name}/{sale} tại con trỏ (2026-06-08) */
.bed-var-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  padding-top: 10px;
  margin-top: 2px;
}
.bed-var-bar-label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 600;
  color: var(--ink-3);
}
.bed-var-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 9px;
  border-radius: var(--r-pill);
  border: 1px solid var(--brand-bright);
  background: var(--brand-soft);
  color: var(--brand-700);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.12s, transform 0.12s;
}
.bed-var-chip:hover { background: var(--brand-softer); transform: translateY(-1px); }
.bed-var-chip:active { transform: translateY(0); }
.bed-var-chip code {
  font-family: var(--mono);
  font-size: 10.5px;
  background: transparent;
  color: inherit;
}
.bed-var-chip-label { color: var(--ink-3); font-weight: 500; font-size: 10px; }
.bed-hint-block { display: block; margin-top: 12px; font-style: normal; }
.bed-hint code {
  background: var(--surface-3);
  color: var(--ink-2);
  padding: 1px 5px;
  border-radius: 3px;
  font-family: var(--mono);
  font-size: 11px;
}

.bed-field-label {
  display: block;
  font-size: 11px;
  font-weight: 600;
  color: var(--ink-3);
  text-transform: uppercase;
  letter-spacing: 0.4px;
  margin: 10px 0 4px;
}
.bed-input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--line);
  border-radius: var(--r-xs);
  font-size: 13px;
  font-family: inherit;
  outline: none;
  color: var(--ink);
  background: var(--surface);
}
.bed-input:focus { border-color: var(--brand); box-shadow: 0 0 0 3px var(--brand-soft); }
.bed-album-row { display: flex; gap: 6px; margin-bottom: 6px; align-items: center; }
.bed-album-row .bed-input { flex: 1; }
/* D7: album chọn từ Kho — lưới thumbnail thay danh sách ô URL. */
.bed-album-thumbs { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }
.bed-album-thumb { position: relative; width: 72px; height: 72px; border-radius: 8px; overflow: hidden; border: 1px solid var(--hairline, #ddd); }
.bed-album-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.bed-album-thumb-x {
  position: absolute; top: 2px; right: 2px;
  width: 18px; height: 18px; border-radius: 50%;
  border: none; cursor: pointer;
  background: rgba(31, 35, 40, .72); color: #fff;
  display: flex; align-items: center; justify-content: center; padding: 0;
}
.bed-album-thumb-x:hover { background: rgba(170, 45, 0, .9); }

.bed-empty-editor {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--ink-4);
  font-size: 13px;
}

/* Col 3 Zalo preview — 2026-06-08: 3 cột BẰNG NHAU + COPY UI xem trước Khối ở chat
   (BlockPreviewDialog): bong bóng TRẮNG viền xám, nền xanh nhạt gradient, chip "Tin x/y". */
.bed-col3 {
  flex: 1 1 0;
  min-width: 0;
  min-height: 0; /* con .bed-zalo-window (overflow-y:auto) co lại đúng để cuộn preview */
  overflow: hidden;
  background: linear-gradient(180deg, #e3f2fd 0%, #bbdefb 100%);
  border-left: 1px solid var(--line);
  display: flex;
  flex-direction: column;
}
.bed-col3-head {
  padding: 11px 14px;
  background: var(--surface);
  color: var(--ink);
  border-bottom: 1px solid var(--line);
  font-size: 12px;
  font-weight: 600;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.bed-col3-head > span:first-child { display: inline-flex; align-items: center; gap: 6px; }
.bed-live { display: inline-flex; align-items: center; gap: 5px; font-size: 10.5px; }
.bed-live-dot {
  width: 7px;
  height: 7px;
  background: var(--success);
  border-radius: 50%;
  animation: pulse 1.4s ease-in-out infinite;
}
@keyframes pulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.4 } }
.bed-zalo-window {
  flex: 1;
  padding: 14px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow-y: auto;
  background: linear-gradient(180deg, #e3f2fd 0%, #cfe5fb 100%);
}
.bed-zalo-time-label {
  align-self: center;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: #475569;
  padding: 4px 10px;
  font-weight: 500;
  text-align: center;
}
.bed-zalo-bubble {
  max-width: 85%;
  padding: 10px 14px;
  border-radius: 14px;
  font-size: 13px;
  line-height: 1.5;
  word-wrap: break-word;
  white-space: pre-wrap;
}
/* Copy BlockPreviewDialog (.bpd-bubble.out): trắng, viền xám, chữ tối. */
.bed-zalo-bubble.out {
  background: #fff;
  color: #1f2328;
  border: 1px solid #e3e6ea;
  align-self: flex-end;
  border-bottom-right-radius: 5px;
}
/* Format marks render trong bubble (từ applyRichFormat v-html) */
.bed-zalo-bubble :deep(strong) { font-weight: 700; }
.bed-zalo-bubble :deep(em) { font-style: italic; }
.bed-zalo-bubble :deep(u) { text-decoration: underline; }
.bed-zalo-bubble :deep(s) { text-decoration: line-through; }
/* Media preview — copy gradient màu của BlockPreviewDialog ở chat (xanh lá/cam…). */
.bed-zalo-image {
  width: 180px;
  height: 112px;
  background: linear-gradient(135deg, #a7f3d0, #10b981);
  border-radius: 12px;
  border-bottom-right-radius: 5px;
  align-self: flex-end;
  overflow: hidden;
}
/* YC3: hiện ẢNH THẬT đã chọn ở Col2 (fallback gradient khi chưa chọn). */
.bed-zalo-image img { width: 100%; height: 100%; object-fit: cover; display: block; }
.bed-zalo-album {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 3px;
  width: 200px;
  border-radius: 12px;
  border-bottom-right-radius: 5px;
  overflow: hidden;
  align-self: flex-end;
}
.bed-zalo-album-item {
  aspect-ratio: 1;
  background: linear-gradient(135deg, #fde68a, #f59e0b);
  overflow: hidden;
}
.bed-zalo-album-item img { width: 100%; height: 100%; object-fit: cover; display: block; }
.bed-zalo-album-item:nth-child(2) { background: linear-gradient(135deg, #a7f3d0, #10b981); }
.bed-zalo-album-item:nth-child(3) { background: linear-gradient(135deg, #bfdbfe, #3b82f6); }
.bed-zalo-album-item:nth-child(4) { background: linear-gradient(135deg, #fbcfe8, #ec4899); }
.bed-zalo-file {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  align-self: flex-end;
  background: #fff;
  border-radius: 12px;
  padding: 11px 14px;
  font-size: 12.5px;
  color: #1f2328;
  max-width: 240px;
  border-bottom-right-radius: 5px;
}
.bed-zalo-video {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  align-self: flex-end;
  background: #1f2328;
  color: #fff;
  border-radius: 12px;
  padding: 22px 40px;
  font-size: 13px;
  border-bottom-right-radius: 5px;
}
/* D5: video play được trong preview Zalo. */
.bed-zalo-video-player {
  align-self: flex-end;
  width: 200px;
  max-width: 100%;
  max-height: 150px;
  border-radius: 12px;
  border-bottom-right-radius: 5px;
  background: #000;
  display: block;
}
.bed-zalo-system {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  align-self: center;
  background: rgba(255,255,255,0.7);
  padding: 8px 14px;
  border-radius: 12px;
  font-size: 11.5px;
  color: var(--ink-2);
  text-align: center;
}
.bed-zalo-time {
  font-size: 10px;
  color: #475569;
  align-self: flex-end;
  padding: 0 6px;
  margin-top: -2px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
/* Chip "Tin x/y" — copy .bpd-tin-label ở chat preview (pill trắng mờ). */
.bed-zalo-tin {
  background: rgba(255,255,255,0.6);
  padding: 1px 6px;
  border-radius: 8px;
  font-weight: 600;
}
.bed-zalo-empty {
  align-self: center;
  font-size: 11.5px;
  color: var(--ink-3);
  font-style: italic;
  background: rgba(255,255,255,0.6);
  padding: 16px 20px;
  border-radius: var(--r-md);
  text-align: center;
}
.bed-col3-foot {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 6px;
  padding: 10px 12px;
  background: rgba(255,255,255,0.7);
  border-top: 1px solid var(--line);
  font-size: 10.5px;
  color: var(--brand-700);
  font-weight: 500;
}

.bed-error {
  position: fixed;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--error-soft);
  color: var(--error);
  border: 1px solid #f6b9b4;
  padding: 10px 18px;
  border-radius: var(--r-sm);
  font-size: 13px;
  box-shadow: var(--sh-lg);
  z-index: 100;
}
</style>

<!-- GLOBAL (không scoped): v-dialog teleport ra <body> nên scoped không với tới
     .v-overlay__content. YC1 anh chốt 2026-06-16: dialog Khối CHỪA thanh nav hệ thống
     (--smax-topnav-h = 48px) phía trên, KHÔNG đè lên. Đã tắt scrim (:scrim="false") +
     overlay-root pointer-events:none → topnav phía dưới vẫn bấm được. -->
<style>
.v-overlay__content.bed-fs-content {
  top: var(--smax-topnav-h, 48px) !important;
  height: calc(100% - var(--smax-topnav-h, 48px)) !important;
  max-height: calc(100% - var(--smax-topnav-h, 48px)) !important;
}
</style>
