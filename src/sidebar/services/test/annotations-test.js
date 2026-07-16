import sinon from 'sinon';

import * as fixtures from '../../test/annotation-fixtures';
import { AnnotationsService, $imports } from '../annotations';

describe('AnnotationsService', () => {
  let fakeAnnotationActivity;
  let fakeApi;
  let fakeMetadata;
  let fakeTagInventoryGroupSync;
  let fakeSettings;
  let fakeStore;

  let fakeDefaultPermissions;
  let fakePrivatePermissions;
  let fakeSharedPermissions;
  let fakeIsPrivate;

  let fakeExperimentLog;
  let fakeClaude;
  let svc;

  function setLoggedIn(loggedIn) {
    const profile = loggedIn
      ? { userid: 'acct:foo@bar.com', user_info: {} }
      : { userid: null };
    fakeStore.profile.returns(profile);
    fakeStore.isLoggedIn.returns(loggedIn);
  }

  // The minimal data needed for a `create` call.
  const emptyAnnotationData = {
    target: [
      {
        source: 'https://example.com',
      },
    ],
  };

  beforeEach(() => {
    fakeAnnotationActivity = {
      reportActivity: sinon.stub(),
    };
    fakeApi = {
      annotation: {
        read: sinon.stub().resolves(fixtures.defaultAnnotation()),
        create: sinon.stub().resolves(fixtures.defaultAnnotation()),
        delete: sinon.stub().resolves(),
        flag: sinon.stub().resolves(),
        update: sinon.stub().resolves(fixtures.defaultAnnotation()),
        moderate: sinon.stub().resolves(fixtures.defaultAnnotation()),
      },
    };

    fakeDefaultPermissions = sinon.stub();
    fakePrivatePermissions = sinon.stub();
    fakeSharedPermissions = sinon.stub();

    fakeMetadata = {
      isAnnotation: sinon.stub(),
      isHighlight: sinon.stub(),
      isSaved: sinon.stub(),
      isPageNote: sinon.stub(),
      quote: sinon.stub().returns(null),
    };

    fakeIsPrivate = sinon.stub();
    fakeTagInventoryGroupSync = {
      applyStoreAnnotationsToInventory: sinon.stub().returns(Promise.resolve()),
    };

    fakeSettings = {};

    fakeStore = {
      addAnnotations: sinon.stub(),
      annotationSaveFinished: sinon.stub(),
      annotationSaveStarted: sinon.stub(),
      createDraft: sinon.stub(),
      deleteNewAndEmptyDrafts: sinon.stub(),
      focusedGroupId: sinon.stub().returns('test-group'),
      getDefault: sinon.stub(),
      getDraft: sinon.stub().returns(null),
      isLoggedIn: sinon.stub().returns(true),
      mainFrame: sinon.stub().returns({ uri: 'http://www.example.com' }),
      openSidebarPanel: sinon.stub(),
      profile: sinon.stub().returns({}),
      removeAnnotations: sinon.stub(),
      removeAnnotationIdsFromTagInventoryRows: sinon.stub(),
      addTagInventoryRow: sinon.stub(),
      tagInventoryRows: sinon.stub().returns([]),
      removeDraft: sinon.stub(),
      selectTab: sinon.stub(),
      setExpanded: sinon.stub(),
      updateFlagStatus: sinon.stub(),
      defaultAuthority: sinon.stub().returns('hypothes.is'),
      isFeatureEnabled: sinon.stub().returns(false),
    };

    setLoggedIn(true);

    fakeExperimentLog = {
      logAccept: sinon.stub(),
      logReject: sinon.stub(),
      logAnnotationDeleted: sinon.stub(),
      logReclassifyAsManual: sinon.stub(),
    };

    fakeClaude = {
      apiKey: sinon.stub().returns(''),
      resolvePdfLineBreakHyphens: sinon.stub().resolves([]),
    };

    $imports.$mock({
      '../helpers/annotation-metadata': fakeMetadata,
      '../helpers/permissions': {
        defaultPermissions: fakeDefaultPermissions,
        privatePermissions: fakePrivatePermissions,
        sharedPermissions: fakeSharedPermissions,
        isPrivate: fakeIsPrivate,
      },
    });

    svc = new AnnotationsService(
      fakeAnnotationActivity,
      fakeTagInventoryGroupSync,
      fakeApi,
      fakeClaude,
      fakeExperimentLog,
      fakeSettings,
      fakeStore,
    );
  });

  afterEach(() => {
    $imports.$restore();
  });

  const getLastAddedAnnotation = () => {
    if (fakeStore.addAnnotations.callCount <= 0) {
      return null;
    }
    const callCount = fakeStore.addAnnotations.callCount;
    return fakeStore.addAnnotations.getCall(callCount - 1).args[0][0];
  };

  describe('create', () => {
    let now;

    beforeEach(() => {
      now = new Date();

      fakeStore.focusedGroupId.returns('mygroup');
    });

    it('extends the provided annotation object with defaults', () => {
      fakeStore.focusedGroupId.returns('mygroup');

      svc.create(emptyAnnotationData, now);

      const annotation = getLastAddedAnnotation();

      assert.equal(annotation.created, now.toISOString());
      assert.equal(annotation.group, 'mygroup');
      assert.isArray(annotation.tags);
      assert.isEmpty(annotation.tags);
      assert.isString(annotation.text);
      assert.isEmpty(annotation.text);
      assert.equal(annotation.updated, now.toISOString());
      assert.equal(annotation.user, 'acct:foo@bar.com');
      assert.isOk(annotation.$tag);
      assert.isString(annotation.$tag);

      // `annotationMetadata` config not set, so this field should also not be set.
      assert.isUndefined(annotation.metadata);
    });

    it('adds metadata from `annotationMetadata` setting to annotation', () => {
      fakeStore.focusedGroupId.returns('mygroup');
      fakeSettings.annotationMetadata = {
        lms: { assignment_id: '1234' },
      };

      svc.create(emptyAnnotationData, now);

      const annotation = getLastAddedAnnotation();
      assert.deepEqual(annotation.metadata, fakeSettings.annotationMetadata);
    });

    describe('annotation permissions', () => {
      it('sets private permissions if default privacy level is "private"', () => {
        fakeStore.getDefault.returns('private');
        fakeDefaultPermissions.returns('private-permissions');

        svc.create(emptyAnnotationData, now);
        const annotation = getLastAddedAnnotation();

        assert.calledOnce(fakeDefaultPermissions);
        assert.calledWith(
          fakeDefaultPermissions,
          'acct:foo@bar.com',
          'mygroup',
          'private',
        );
        assert.equal(annotation.permissions, 'private-permissions');
      });

      it('sets shared permissions if default privacy level is "shared"', () => {
        fakeStore.getDefault.returns('shared');
        fakeDefaultPermissions.returns('default permissions');

        svc.create(emptyAnnotationData, now);
        const annotation = getLastAddedAnnotation();

        assert.calledOnce(fakeDefaultPermissions);
        assert.calledWith(
          fakeDefaultPermissions,
          'acct:foo@bar.com',
          'mygroup',
          'shared',
        );
        assert.equal(annotation.permissions, 'default permissions');
      });

      it('sets private permissions if annotation is a highlight', () => {
        fakeMetadata.isHighlight.returns(true);
        fakePrivatePermissions.returns('private permissions');
        fakeDefaultPermissions.returns('default permissions');

        svc.create(emptyAnnotationData, now);
        const annotation = getLastAddedAnnotation();

        assert.calledOnce(fakePrivatePermissions);
        assert.equal(annotation.permissions, 'private permissions');
      });
    });

    it('creates a draft for the new annotation', () => {
      fakeMetadata.isHighlight.returns(false);

      svc.create(fixtures.newAnnotation(), now);

      assert.calledOnce(fakeStore.createDraft);
    });

    it('adds the annotation to the store', () => {
      svc.create(fixtures.newAnnotation(), now);

      assert.calledOnce(fakeStore.addAnnotations);
    });

    it('deletes other empty drafts for new annotations', () => {
      svc.create(fixtures.newAnnotation(), now);

      assert.calledOnce(fakeStore.deleteNewAndEmptyDrafts);
    });

    it('does not create a draft if the annotation is a highlight', () => {
      fakeMetadata.isHighlight.returns(true);

      svc.create(fixtures.newAnnotation(), now);

      assert.notCalled(fakeStore.createDraft);
    });

    describe('automatic tab selection', () => {
      it('sets the active tab to "Page Notes" if the annotation is a Page Note', () => {
        fakeMetadata.isPageNote.returns(true);

        svc.create(fixtures.newAnnotation(), now);

        assert.calledOnce(fakeStore.selectTab);
        assert.calledWith(fakeStore.selectTab, 'note');
      });

      it('sets the active tab to "Annotations" if the annotation is an annotation', () => {
        fakeMetadata.isAnnotation.returns(true);

        svc.create(fixtures.newAnnotation(), now);

        assert.calledOnce(fakeStore.selectTab);
        assert.calledWith(fakeStore.selectTab, 'annotation');
      });

      it('does nothing if the annotation is neither an annotation nor a page note (e.g. reply)', () => {
        fakeMetadata.isAnnotation.returns(false);
        fakeMetadata.isPageNote.returns(false);

        svc.create(fixtures.newAnnotation(), now);

        assert.notCalled(fakeStore.selectTab);
      });
    });

    it("expands all of the new annotation's parents", () => {
      const annot = fixtures.newAnnotation();
      annot.references = ['aparent', 'anotherparent', 'yetanotherancestor'];

      svc.create(annot, now);

      assert.equal(fakeStore.setExpanded.callCount, 3);
      assert.calledWith(fakeStore.setExpanded, 'aparent', true);
      assert.calledWith(fakeStore.setExpanded, 'anotherparent', true);
      assert.calledWith(fakeStore.setExpanded, 'yetanotherancestor', true);
    });

    it('throws if the user is not logged in', () => {
      setLoggedIn(false);

      assert.throws(() => {
        svc.create(fixtures.newAnnotation(), now);
      }, 'Cannot create annotation when logged out');
    });

    it('throws an error if there is no focused group', () => {
      fakeStore.focusedGroupId.returns(null);

      assert.throws(() => {
        svc.create(fixtures.newAnnotation(), now);
      }, 'Cannot create annotation without a group');
    });
  });

  describe('createPageNote', () => {
    it('should open the login-prompt panel if the user is not logged in', () => {
      setLoggedIn(false);

      svc.createPageNote();

      assert.calledWith(fakeStore.openSidebarPanel, 'loginPrompt');
      assert.isNull(getLastAddedAnnotation());
    });

    it('should do nothing if there is no main frame URI', () => {
      fakeStore.mainFrame.returns(undefined);

      svc.createPageNote();

      assert.notCalled(fakeStore.openSidebarPanel);
      assert.isNull(getLastAddedAnnotation());
    });

    it.each([undefined, { title: 'foo' }])(
      'should create a new unsaved annotation with page note defaults',
      document => {
        svc.createPageNote(document);

        const annotation = getLastAddedAnnotation();

        assert.equal(annotation.uri, 'http://www.example.com');
        assert.deepEqual(annotation.target, [
          {
            source: 'http://www.example.com',
          },
        ]);
        assert.deepEqual(annotation.document, document);
      },
    );
  });

  describe('delete', () => {
    it('removes the annotation via the API', async () => {
      const annot = fixtures.defaultAnnotation();
      await svc.delete(annot);
      assert.calledWith(fakeApi.annotation.delete, { id: annot.id });
    });

    it('removes the annotation from the store', async () => {
      const annot = fixtures.defaultAnnotation();
      await svc.delete(annot);
      assert.calledWith(fakeStore.removeAnnotations, [annot]);
    });

    it('does not remove the annotation from the store if the API call fails', async () => {
      fakeApi.annotation.delete.rejects(new Error('Annotation does not exist'));
      const annot = fixtures.defaultAnnotation();

      await assert.rejects(svc.delete(annot), 'Annotation does not exist');
      assert.notCalled(fakeStore.removeAnnotations);
    });

    it('reports delete-annotation activity', async () => {
      const annot = fixtures.defaultAnnotation();
      await svc.delete(annot);
      assert.calledOnce(fakeAnnotationActivity.reportActivity);
      assert.calledWith(fakeAnnotationActivity.reportActivity, 'delete', annot);
    });
  });

  describe('flag', () => {
    it('flags the annotation via the API', async () => {
      const annot = fixtures.defaultAnnotation();
      await svc.flag(annot);
      assert.calledWith(fakeApi.annotation.flag, { id: annot.id });
    });

    it('updates the flag status in the store', async () => {
      const annot = fixtures.defaultAnnotation();
      await svc.flag(annot);
      assert.calledWith(fakeStore.updateFlagStatus, annot.id, true);
    });

    it('does not update the flag status if the API call fails', async () => {
      fakeApi.annotation.flag.rejects(new Error('Annotation does not exist'));
      const annot = fixtures.defaultAnnotation();

      await assert.rejects(svc.flag(annot), 'Annotation does not exist');
      assert.notCalled(fakeStore.updateFlagStatus);
    });

    it('reports flag-annotation activity', async () => {
      const annot = fixtures.defaultAnnotation();
      await svc.flag(annot);
      assert.calledOnce(fakeAnnotationActivity.reportActivity);
      assert.calledWith(fakeAnnotationActivity.reportActivity, 'flag', annot);
    });
  });

  describe('reply', () => {
    const filledAnnotation = () => {
      const annot = fixtures.defaultAnnotation();
      annot.group = 'mix3boop';
      annot.references = ['feedbeef'];

      return annot;
    };

    it('creates a new annotation in the store', () => {
      const annotation = fixtures.defaultAnnotation();

      svc.reply(annotation, 'acct:foo@bar.com');

      assert.calledOnce(fakeStore.addAnnotations);
    });

    it('associates the reply with the annotation', () => {
      const annotation = filledAnnotation();

      svc.reply(annotation, 'acct:foo@bar.com');

      const reply = fakeStore.addAnnotations.getCall(0).args[0][0];

      assert.equal(
        reply.references[reply.references.length - 1],
        annotation.id,
      );
      assert.equal(reply.group, annotation.group);
      assert.equal(reply.target[0].source, annotation.target[0].source);
      assert.equal(reply.uri, annotation.uri);
    });

    it('uses public permissions if annotation is public', () => {
      fakeIsPrivate.returns(false);
      fakeSharedPermissions.returns('public');

      const annotation = filledAnnotation();

      svc.reply(annotation, 'acct:foo@bar.com');

      const reply = fakeStore.addAnnotations.getCall(0).args[0][0];
      assert.equal(reply.permissions, 'public');
    });

    it('uses private permissions if annotation is private', () => {
      fakeIsPrivate.returns(true);
      fakePrivatePermissions.returns('private');

      const annotation = filledAnnotation();

      svc.reply(annotation, 'acct:foo@bar.com');

      const reply = fakeStore.addAnnotations.getCall(0).args[0][0];
      assert.equal(reply.permissions, 'private');
    });
  });

  describe('save', () => {
    it('calls the `create` API service for new annotations', () => {
      fakeMetadata.isSaved.returns(false);
      // Using the new-annotation fixture has no bearing on which API method
      // will get called because `isNew` is mocked, but it has representative
      // properties
      const annotation = fixtures.newAnnotation();
      return svc.save(annotation).then(() => {
        assert.calledOnce(fakeApi.annotation.create);
        assert.notCalled(fakeApi.annotation.update);
        assert.calledOnce(fakeStore.annotationSaveStarted);
        assert.calledOnce(fakeStore.annotationSaveFinished);
      });
    });

    it('enriches PDF quote display on save when Claude key and hyphen cases exist', async () => {
      fakeMetadata.isSaved.returns(false);
      fakeMetadata.quote.callsFake(ann => {
        const sel = ann.target?.[0]?.selector?.find(
          s => s.type === 'TextQuoteSelector',
        );
        return sel ? (sel.displayExact ?? sel.exact) : null;
      });
      fakeClaude.apiKey.returns('test-key');
      fakeClaude.resolvePdfLineBreakHyphens.resolves([
        { before: 'analy', after: 'sis', action: 'drop' },
      ]);
      fakeApi.annotation.create.callsFake((_params, payload) =>
        Promise.resolve({
          ...fixtures.defaultAnnotation(),
          ...payload,
          id: 'deadbeef',
        }),
      );

      const annotation = fixtures.newAnnotation();
      annotation.target = [
        {
          source: annotation.uri,
          selector: [
            {
              type: 'TextQuoteSelector',
              exact: 'analy-sis of',
              displayExact: 'analy-sis of',
              pdfLineBreakHyphens: [{ before: 'analy', after: 'sis' }],
            },
          ],
        },
      ];

      await svc.save(annotation);

      assert.calledOnce(fakeClaude.resolvePdfLineBreakHyphens);
      const savedPayload = fakeApi.annotation.create.getCall(0).args[1];
      const quote = savedPayload.target[0].selector[0];
      assert.equal(quote.displayExact, 'analysis of');
      assert.isUndefined(quote.pdfLineBreakHyphens);

      const storedAnnotation = fakeStore.addAnnotations.getCall(0).args[0][0];
      const storedQuote = storedAnnotation.target[0].selector.find(
        s => s.type === 'TextQuoteSelector',
      );
      assert.equal(storedQuote.displayExact, 'analysis of');
    });

    it('skips Claude enrichment on save when API key is not set', async () => {
      fakeMetadata.isSaved.returns(false);
      fakeClaude.apiKey.returns('');

      const annotation = fixtures.newAnnotation();
      annotation.target = [
        {
          source: annotation.uri,
          selector: [
            {
              type: 'TextQuoteSelector',
              exact: 'analy-sis of',
              displayExact: 'analy-sis of',
              pdfLineBreakHyphens: [{ before: 'analy', after: 'sis' }],
            },
          ],
        },
      ];

      await svc.save(annotation);

      assert.notCalled(fakeClaude.resolvePdfLineBreakHyphens);
      const savedPayload = fakeApi.annotation.create.getCall(0).args[1];
      const quote = savedPayload.target[0].selector[0];
      assert.equal(quote.displayExact, 'analy-sis of');
      assert.isUndefined(quote.pdfLineBreakHyphens);
    });

    it('reports create-annotation activity for new annotations', async () => {
      fakeMetadata.isSaved.returns(false);
      const annotation = fixtures.newAnnotation();

      const savedAnnotation = await svc.save(annotation);
      assert.calledOnce(fakeAnnotationActivity.reportActivity);
      assert.calledWith(
        fakeAnnotationActivity.reportActivity,
        'create',
        savedAnnotation,
      );
    });

    it('calls the `update` API service for pre-existing annotations', () => {
      fakeMetadata.isSaved.returns(true);

      const annotation = fixtures.defaultAnnotation();
      return svc.save(annotation).then(() => {
        assert.calledOnce(fakeApi.annotation.update);
        assert.notCalled(fakeApi.annotation.create);
        assert.calledOnce(fakeStore.annotationSaveStarted);
        assert.calledOnce(fakeStore.annotationSaveFinished);
      });
    });

    it('reports update-annotation activity for pre-existing annotations', async () => {
      fakeMetadata.isSaved.returns(true);
      const annotation = fixtures.defaultAnnotation();

      const savedAnnotation = await svc.save(annotation);
      assert.calledOnce(fakeAnnotationActivity.reportActivity);
      assert.calledWith(
        fakeAnnotationActivity.reportActivity,
        'update',
        savedAnnotation,
      );
    });

    it('calls the relevant API service with an object that has any draft changes integrated', async () => {
      fakeMetadata.isSaved.returns(false);
      fakePrivatePermissions.returns({ read: ['foo'] });
      const annotation = fixtures.defaultAnnotation();
      annotation.text = 'not this';
      annotation.tags = ['nope'];

      fakeStore.getDraft.returns({
        tags: ['one', 'two'],
        text: 'my text',
        isPrivate: true,
        description: 'Image description',
        annotation: fixtures.defaultAnnotation(),
      });

      await svc.save(fixtures.defaultAnnotation());

      const annotationWithChanges =
        fakeApi.annotation.create.getCall(0).args[1];
      assert.equal(annotationWithChanges.text, 'my text');
      assert.sameMembers(annotationWithChanges.tags, ['one', 'two']);
      // Permissions converted to "private"
      assert.include(annotationWithChanges.permissions.read, 'foo');
      assert.notInclude(annotationWithChanges.permissions.read, [
        'group:__world__',
      ]);
      assert.equal(
        annotationWithChanges.target[0].description,
        'Image description',
      );
    });

    [
      {
        profile: { userid: 'acct:foo@bar.com' },
        mentionsEnabled: false,
        text: 'hello @bob',
        expectedText: 'hello @bob',
        mentionMode: 'username',
      },
      {
        profile: { userid: 'acct:foo@bar.com' },
        mentionsEnabled: false,
        text: 'hello @[John Doe]',
        expectedText: 'hello @[John Doe]',
        mentionMode: 'display-name',
      },
      {
        profile: { userid: 'acct:foo@bar.com' },
        mentionsEnabled: true,
        text: 'hello @bob',
        expectedText:
          'hello <a data-hyp-mention="" data-userid="acct:bob@bar.com">@bob</a>',
        mentionMode: 'username',
      },
      {
        profile: { userid: 'acct:foo@bar.com' },
        mentionsEnabled: true,
        text: 'hello @[John Doe]',
        expectedText:
          'hello <a data-hyp-mention="" data-userid="acct:john_doe@hypothes.is">@John Doe</a>',
        mentionMode: 'display-name',
      },
      {
        profile: { userid: 'acct:foo' },
        mentionsEnabled: true,
        text: 'hello @bob',
        expectedText:
          'hello <a data-hyp-mention="" data-userid="acct:bob@hypothes.is">@bob</a>',
        mentionMode: 'username',
      },
      {
        profile: { userid: 'acct:foo@bar.com' },
        mentionsEnabled: true,
        text: 'hello @[Unknown Display Name]',
        expectedText: 'hello @[Unknown Display Name]',
        mentionMode: 'display-name',
      },
    ].forEach(
      ({ profile, mentionsEnabled, text, expectedText, mentionMode }) => {
        it('wraps mentions in tags when feature is enabled', async () => {
          fakeStore.isFeatureEnabled.returns(mentionsEnabled);
          fakeStore.profile.returns(profile);
          fakeStore.getDraft.returns({ text });

          await svc.save(fixtures.defaultAnnotation(), {
            mentionMode,
            usersMap: new Map([
              ['John Doe', { userid: 'acct:john_doe@hypothes.is' }],
            ]),
          });

          assert.calledWith(
            fakeApi.annotation.create,
            {},
            sinon.match({ text: expectedText }),
          );
        });
      },
    );

    context('successful save', () => {
      it('copies over internal app-specific keys to the annotation object', () => {
        fakeMetadata.isSaved.returns(true);
        const annotation = fixtures.defaultAnnotation();
        annotation.$tag = 'mytag';
        annotation.$foo = 'bar';

        // The fixture here has no `$`-prefixed props
        fakeApi.annotation.update.resolves(fixtures.defaultAnnotation());

        return svc.save(annotation).then(() => {
          const savedAnnotation =
            fakeStore.addAnnotations.getCall(0).args[0][0];
          assert.equal(savedAnnotation.$tag, 'mytag');
          assert.equal(savedAnnotation.$foo, 'bar');
        });
      });

      it('removes the annotation draft', () => {
        const annotation = fixtures.defaultAnnotation();

        return svc.save(annotation).then(() => {
          assert.calledWith(fakeStore.removeDraft, annotation);
        });
      });

      it('adds the updated annotation to the store', () => {
        const annotation = fixtures.defaultAnnotation();
        fakeMetadata.isSaved.returns(true);
        fakeApi.annotation.update.resolves(annotation);

        return svc.save(annotation).then(() => {
          assert.calledWith(fakeStore.addAnnotations, [annotation]);
        });
      });

      it('syncs group history after successful save', async () => {
        fakeMetadata.isSaved.returns(true);
        const annotation = fixtures.defaultAnnotation();
        annotation.tags = [];
        fakeStore.getDraft.returns({
          annotation,
          tags: ['methods'],
          text: annotation.text ?? '',
          isPrivate: false,
          description: annotation.target[0]?.description,
        });
        const savedAnnotation = { ...annotation, tags: ['methods'] };
        fakeApi.annotation.update.resolves(savedAnnotation);

        await svc.save(annotation);

        assert.calledOnce(fakeTagInventoryGroupSync.applyStoreAnnotationsToInventory);
      });
    });

    context('AI reclassify on manual detachment', () => {
      it('strips AI tags and logs text-change when comment text changes', async () => {
        fakeMetadata.isSaved.returns(true);
        fakeMetadata.quote.returns('quoted passage');
        const annotation = fixtures.defaultAnnotation();
        annotation.tags = ['ai-pending', 'methods'];
        annotation.text = 'find stats';
        fakeStore.getDraft.returns({
          annotation,
          tags: ['ai-pending', 'methods'],
          text: 'edited comment',
          isPrivate: false,
          description: annotation.target[0]?.description,
        });
        const savedAnnotation = {
          ...annotation,
          tags: ['methods'],
          text: 'edited comment',
        };
        fakeApi.annotation.update.resolves(savedAnnotation);

        await svc.save(annotation);

        const sent = fakeApi.annotation.update.getCall(0).args[1];
        assert.notInclude(sent.tags, 'ai-pending');
        assert.notInclude(sent.tags, 'ai-user-approved');
        assert.calledOnce(fakeExperimentLog.logReclassifyAsManual);
        assert.calledWith(
          fakeExperimentLog.logReclassifyAsManual,
          sinon.match({
            reason: 'text-change',
            schemaTag: 'methods',
            originalQuery: 'find stats',
            newText: 'edited comment',
            quoteText: 'quoted passage',
          }),
        );
      });

      it('strips AI tags and logs schema-tag-removed when schema tag is removed', async () => {
        fakeMetadata.isSaved.returns(true);
        const annotation = fixtures.defaultAnnotation();
        annotation.tags = ['ai-pending', 'methods'];
        annotation.text = 'find stats';
        fakeStore.getDraft.returns({
          annotation,
          tags: ['ai-pending'],
          text: 'find stats',
          isPrivate: false,
          description: annotation.target[0]?.description,
        });
        const savedAnnotation = {
          ...annotation,
          tags: [],
          text: 'find stats',
        };
        fakeApi.annotation.update.resolves(savedAnnotation);

        await svc.save(annotation);

        const sent = fakeApi.annotation.update.getCall(0).args[1];
        assert.notInclude(sent.tags, 'ai-pending');
        assert.calledWith(
          fakeExperimentLog.logReclassifyAsManual,
          sinon.match({
            reason: 'schema-tag-removed',
            removedSchemaTags: ['methods'],
          }),
        );
      });

      it('strips AI tags when swapping schema tag methods to results', async () => {
        fakeMetadata.isSaved.returns(true);
        const annotation = fixtures.defaultAnnotation();
        annotation.tags = ['ai-user-approved', 'methods'];
        annotation.text = 'find stats';
        fakeStore.getDraft.returns({
          annotation,
          tags: ['ai-user-approved', 'results'],
          text: 'find stats',
          isPrivate: false,
          description: annotation.target[0]?.description,
        });
        fakeApi.annotation.update.resolves({
          ...annotation,
          tags: ['results'],
        });

        await svc.save(annotation);

        const sent = fakeApi.annotation.update.getCall(0).args[1];
        assert.notInclude(sent.tags, 'ai-user-approved');
        assert.calledOnce(fakeExperimentLog.logReclassifyAsManual);
      });

      it('does not auto-strip when user removes only ai-pending tag', async () => {
        fakeMetadata.isSaved.returns(true);
        const annotation = fixtures.defaultAnnotation();
        annotation.tags = ['ai-pending', 'methods'];
        annotation.text = 'find stats';
        fakeStore.getDraft.returns({
          annotation,
          tags: ['methods'],
          text: 'find stats',
          isPrivate: false,
          description: annotation.target[0]?.description,
        });
        fakeApi.annotation.update.resolves({
          ...annotation,
          tags: ['methods'],
        });

        await svc.save(annotation);

        const sent = fakeApi.annotation.update.getCall(0).args[1];
        assert.sameMembers(sent.tags, ['methods']);
        assert.notCalled(fakeExperimentLog.logReclassifyAsManual);
      });
    });

    context('error on save', () => {
      it('removes the active save request from the store', () => {
        fakeApi.annotation.update.rejects();
        fakeMetadata.isSaved.returns(true);

        return svc.save(fixtures.defaultAnnotation()).catch(() => {
          assert.notCalled(fakeStore.removeDraft);
          assert.calledOnce(fakeStore.annotationSaveFinished);
        });
      });

      it('does not remove the annotation draft', () => {
        fakeApi.annotation.update.rejects();
        fakeMetadata.isSaved.returns(true);

        return svc.save(fixtures.defaultAnnotation()).catch(() => {
          assert.notCalled(fakeStore.removeDraft);
        });
      });

      it('does not add the annotation to the store', () => {
        fakeApi.annotation.update.rejects();
        fakeMetadata.isSaved.returns(true);

        return svc.save(fixtures.defaultAnnotation()).catch(() => {
          assert.notCalled(fakeStore.addAnnotations);
        });
      });

      it('does not sync group history when save fails', () => {
        fakeApi.annotation.update.rejects();
        fakeMetadata.isSaved.returns(true);
        const annotation = fixtures.defaultAnnotation();
        fakeStore.getDraft.returns({
          annotation,
          tags: ['methods'],
          text: annotation.text ?? '',
          isPrivate: false,
          description: annotation.target[0]?.description,
        });

        return svc.save(annotation).catch(() => {
          assert.notCalled(fakeTagInventoryGroupSync.applyStoreAnnotationsToInventory);
        });
      });
    });
  });

  describe('moderate', () => {
    it('calls the `moderate` API service', async () => {
      const annotation = {
        ...fixtures.defaultAnnotation(),
        moderation_status: 'PENDING',
      };
      await svc.moderate(annotation, 'APPROVED');

      assert.calledWith(
        fakeApi.annotation.moderate,
        { id: annotation.id },
        {
          moderation_status: 'APPROVED',
          current_moderation_status: annotation.moderation_status,
          annotation_updated: annotation.updated,
        },
      );
    });

    it('updates annotation in store', async () => {
      const annotation = fixtures.defaultAnnotation();
      await svc.moderate(annotation, 'APPROVED');

      const savedAnnotation =
        await fakeApi.annotation.moderate.lastCall.returnValue;
      assert.calledWith(fakeStore.addAnnotations, [savedAnnotation]);
      assert.calledOnce(fakeTagInventoryGroupSync.applyStoreAnnotationsToInventory);
    });

    it('swaps ai-pending tags via update when approving', async () => {
      const annotation = {
        ...fixtures.defaultAnnotation(),
        tags: ['ai-pending', 'schema'],
        moderation_status: 'PENDING',
      };
      const updated = {
        ...fixtures.defaultAnnotation(),
        tags: ['schema', 'ai-user-approved'],
      };
      fakeApi.annotation.update.resolves(updated);

      const result = await svc.moderate(annotation, 'APPROVED');

      assert.notCalled(fakeApi.annotation.moderate);
      assert.calledWith(fakeApi.annotation.update, { id: annotation.id }, {
        tags: ['schema', 'ai-user-approved'],
      });
      assert.calledWith(
        fakeStore.addAnnotations,
        [
          sinon.match({
            tags: ['schema', 'ai-user-approved'],
            moderation_status: 'APPROVED',
          }),
        ],
      );
      assert.calledOnce(fakeTagInventoryGroupSync.applyStoreAnnotationsToInventory);
      assert.equal(result.moderation_status, 'APPROVED');
    });

    it('retags ai-pending to a neg-example and keeps it on the server when DENIED', async () => {
      fakeMetadata.quote.returns('the quote');
      const annotation = {
        ...fixtures.defaultAnnotation(),
        tags: ['ai-pending', 'methods'],
        text: 'search query',
        uri: 'http://example.com/doc.pdf',
      };
      const updated = {
        ...fixtures.defaultAnnotation(),
        tags: ['methods-neg-example'],
      };
      fakeApi.annotation.update.resolves(updated);

      const result = await svc.moderate(annotation, 'DENIED');

      assert.notCalled(fakeApi.annotation.moderate);
      assert.notCalled(fakeApi.annotation.delete);
      assert.notCalled(fakeStore.removeAnnotations);
      assert.calledWith(fakeStore.removeAnnotationIdsFromTagInventoryRows, [
        annotation.id,
      ]);
      assert.calledWith(
        fakeApi.annotation.update,
        { id: annotation.id },
        { tags: ['methods-neg-example'] },
      );
      assert.calledWith(fakeStore.addAnnotations, [
        sinon.match({ tags: ['methods-neg-example'] }),
      ]);
      assert.calledOnce(fakeTagInventoryGroupSync.applyStoreAnnotationsToInventory);
      assert.equal(result, updated);
    });

    it('strips system tags and converts positive schema tags on DENY', async () => {
      const annotation = {
        ...fixtures.defaultAnnotation(),
        tags: ['ai-pending', 'ai-user-approved', 'methods'],
      };
      const updated = { ...fixtures.defaultAnnotation() };
      fakeApi.annotation.update.resolves(updated);

      await svc.moderate(annotation, 'DENIED');

      const sentTags = fakeApi.annotation.update.lastCall.args[1].tags;
      assert.sameMembers(sentTags, ['methods-neg-example']);
    });
  });

  describe('tag pill updates', () => {
    it('removeTagFromAnnotation updates tags on the server and store', async () => {
      const annotation = {
        ...fixtures.defaultAnnotation(),
        tags: ['methods', 'other'],
      };
      const updated = {
        ...fixtures.defaultAnnotation(),
        tags: ['other'],
      };
      fakeApi.annotation.update.resolves(updated);

      const result = await svc.removeTagFromAnnotation(annotation, 'methods');

      assert.calledWith(
        fakeApi.annotation.update,
        { id: annotation.id },
        { tags: ['other'] },
      );
      assert.calledWith(fakeStore.addAnnotations, [updated]);
      assert.calledOnce(fakeTagInventoryGroupSync.applyStoreAnnotationsToInventory);
      assert.equal(result, updated);
    });

    it('markTagAsNegativeExample retags one positive schema tag', async () => {
      const annotation = {
        ...fixtures.defaultAnnotation(),
        tags: ['methods', 'other'],
      };
      const updated = {
        ...fixtures.defaultAnnotation(),
        tags: ['other', 'methods-neg-example'],
      };
      fakeApi.annotation.update.resolves(updated);

      const result = await svc.markTagAsNegativeExample(annotation, 'methods');

      assert.calledWith(
        fakeApi.annotation.update,
        { id: annotation.id },
        { tags: ['other', 'methods-neg-example'] },
      );
      assert.equal(result, updated);
    });

    it('revertNegativeExampleTag restores positive schema tag', async () => {
      const annotation = {
        ...fixtures.defaultAnnotation(),
        tags: ['methods-neg-example', 'other'],
      };
      const updated = {
        ...fixtures.defaultAnnotation(),
        tags: ['methods', 'other'],
      };
      fakeApi.annotation.update.resolves(updated);

      const result = await svc.revertNegativeExampleTag(
        annotation,
        'methods-neg-example',
      );

      assert.calledWith(
        fakeApi.annotation.update,
        { id: annotation.id },
        { tags: ['methods', 'other'] },
      );
      assert.equal(result, updated);
    });
  });

  describe('loadAnnotation', () => {
    it('calls the `read` API service', async () => {
      const annotation = fixtures.defaultAnnotation();
      await svc.loadAnnotation(annotation.id);

      assert.calledWith(fakeApi.annotation.read, { id: annotation.id });
    });

    it('updates annotation in store', async () => {
      const annotation = fixtures.defaultAnnotation();
      await svc.loadAnnotation(annotation.id);

      const savedAnnotation =
        await fakeApi.annotation.read.lastCall.returnValue;
      assert.calledWith(fakeStore.addAnnotations, [savedAnnotation]);
    });
  });

  describe('persistEnrichedTargetIfChanged', () => {
    const userId = 'acct:foo@bar.com';

    beforeEach(() => {
      fakeMetadata.isSaved.returns(true);
      fakeStore.profile.returns({ userid: userId });
    });

    it('updates the API when location selectors are newly enriched', async () => {
      const before = {
        ...fixtures.defaultAnnotation(),
        $orphan: false,
        permissions: { read: [], update: [userId], delete: [userId] },
        target: [
          {
            source: 'https://example.com',
            selector: [{ type: 'TextQuoteSelector', exact: 'hello' }],
          },
        ],
      };
      const after = {
        ...before,
        target: [
          {
            source: 'https://example.com',
            selector: [
              { type: 'TextQuoteSelector', exact: 'hello' },
              { type: 'TextPositionSelector', start: 0, end: 5 },
            ],
          },
        ],
      };
      const saved = { ...after, updated: '2020-01-02' };
      fakeApi.annotation.update.resolves(saved);

      svc.persistEnrichedTargetIfChanged(before, after);
      await fakeApi.annotation.update.returnValues[0];

      assert.calledWith(
        fakeApi.annotation.update,
        { id: before.id },
        { target: after.target },
      );
      assert.calledWith(fakeStore.addAnnotations, [saved]);
    });

    it('does not update when location and quote display are unchanged', () => {
      const ann = {
        ...fixtures.defaultAnnotation(),
        $orphan: false,
        permissions: { read: [], update: [userId], delete: [userId] },
        target: [
          {
            source: 'https://example.com',
            selector: [
              { type: 'TextQuoteSelector', exact: 'hello' },
              { type: 'TextPositionSelector', start: 0, end: 5 },
            ],
          },
        ],
      };

      svc.persistEnrichedTargetIfChanged(ann, ann);

      assert.notCalled(fakeApi.annotation.update);
    });

    it('skips unsaved annotations', () => {
      fakeMetadata.isSaved.returns(false);
      const before = fixtures.defaultAnnotation();
      const after = {
        ...before,
        target: [
          {
            source: 'https://example.com',
            selector: [
              { type: 'TextQuoteSelector', exact: 'hello' },
              { type: 'TextPositionSelector', start: 0, end: 5 },
            ],
          },
        ],
      };

      svc.persistEnrichedTargetIfChanged(before, after);

      assert.notCalled(fakeApi.annotation.update);
    });
  });
});
