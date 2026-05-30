sap.ui.define([
    'jquery.sap.global',
    "sap/dm/dme/podfoundation/controller/PluginViewController",
    "sap/ui/model/json/JSONModel",
    "./Utils/Commons",
    "./Utils/ApiPaths",
    "../model/formatter",
    "sap/ui/core/Element",
    "sap/m/MessageBox",
    "sap/m/Dialog",
    "sap/m/Input",
    "sap/m/Button",
    "sap/ui/core/library",
    "sap/ui/core/Fragment"
], function (jQuery, PluginViewController, JSONModel, Commons, ApiPaths, formatter, Element, MessageBox, Dialog, Input, Button, CoreLibrary, Fragment) {
    "use strict";

    var gOperationPhase = {};
    const OPERATION_STATUS = { ACTIVE: "ACTIVE", QUEUED: "IN_QUEUE" }

    return PluginViewController.extend("serviacero.custom.plugins.zpluginPutBatchWCPintado.zpluginPutBatchWCPintado.controller.MainView", {
        Commons: Commons,
        ApiPaths: ApiPaths,
        formatter: formatter,

        onInit: function () {
            PluginViewController.prototype.onInit.apply(this, arguments);
            this.oScanInput = this.byId("scanInput");
            this._suggestedQtyCintas = 0;
            this._cargaTargets = {};
            this.iSecuenciaCounter = 0;

            // Modelo "orderSummary" para resumen de materiales de la BOM
            var oOrderSummaryModel = new JSONModel({
                material: "",
                material2: "",
                descripcion: "",
                descripcion2: "",
                cantidadNecesaria: 0,
                cantidadNecesaria2: 0,
                cantidadConsumida: 0,
                cantidadConsumida2: 0,
                cantidadEscaneada: 0,
                cantidadEscaneada2: 0,
                unidadMedida: "",
                unidadMedida2: "",
                labelCintas: "CINTAS",
                labelAlambre: "ALAMBRE"
            });
            this.getView().setModel(oOrderSummaryModel, "orderSummary");
        },

        /**
         * Helper: devuelve la key activa del SegmentedButton ("CINTAS" o "ALAMBRE")
         */
        _getActiveKey: function () {
            return (this.getView().byId("tableToggle").getSelectedKey()) || "CINTAS";
        },

        /**
         * Helper: devuelve el control Table activo según el SegmentedButton
         */
        _getActiveTable: function () {
            var oView = this.getView();
            return this._getActiveKey() === "CINTAS"
                ? oView.byId("idSlotTableCintas")
                : oView.byId("idSlotTableAlambre");
        },

        /**
         * Handler del SegmentedButton: muestra/oculta las dos tablas
         */
        onToggleTable: function () {
            var oView = this.getView();
            var sKey = oView.byId("tableToggle").getSelectedKey();
            var bCintas = sKey === "CINTAS";
            oView.byId("containerCintas").setVisible(bCintas);
            oView.byId("containerAlambre").setVisible(!bCintas);
            oView.byId("progressContainer").setVisible(bCintas);
            // Sync slotQty display for active table
            var sQty = bCintas
                ? oView.byId("slotQty_cintas").getValue()
                : oView.byId("slotQty_alambre").getValue();
            oView.byId("slotQty").setValue(sQty);
            this._updateProgressIndicator();
        },

        /**
         * Confirma la cantidad asignada para un slot de la tabla activa y persiste al backend.
         */
        onAddQty: function (oEvent) {
            var oView = this.getView();
            var oBundle = oView.getModel("i18n").getResourceBundle();
            var oPODParams = this.Commons.getPODParams(this.getOwnerComponent());
            var self = this;

            var oButton = oEvent.getSource();
            var oItem = oButton.getParent();       // ColumnListItem
            var oTable = oItem.getParent();        // Table
            var oModel = oTable ? oTable.getModel() : null;
            if (!oModel) { return; }

            var iCurrentIndex = oTable.indexOfItem(oItem);
            if (iCurrentIndex === -1) { return; }

            var aCurrentItems = (oModel && oModel.getProperty("/ITEMS")) || [];
            var oSlot = aCurrentItems[iCurrentIndex];
            if (!oSlot || !oSlot.value) {
                sap.m.MessageToast.show(oBundle.getText("sinLotes"));
                return;
            }

            // Fallback a loteQty si cantidadAsignada está vacía o inválida
            var nNewCantidad = parseFloat(oSlot.cantidadAsignada);
            if (isNaN(nNewCantidad) || oSlot.cantidadAsignada === "" || oSlot.cantidadAsignada === undefined) {
                nNewCantidad = parseFloat(oSlot.loteQty);
            }
            var nMaxCantidad = parseFloat(oSlot.loteQty);

            if (isNaN(nNewCantidad) || nNewCantidad <= 0) {
                sap.m.MessageToast.show(oBundle.getText("cantidadInvalida"));
                return;
            }
            if (!isNaN(nMaxCantidad) && nMaxCantidad > 0 && nNewCantidad > nMaxCantidad) {
                sap.m.MessageToast.show(oBundle.getText("cantidadExcedeLote", [nMaxCantidad]));
                return;
            }

            // Capturar referencia MAT!LOTE para localizar el slot tras el refresh
            var sMaterialLoteRef = (oSlot.value || "").trim().toUpperCase().split("!").slice(0, 2).join("!");

            oView.byId("idPluginPanel").setBusy(true);
            this._refreshSlotsFromBackend().then(function (oRefresh) {
                oView.byId("idPluginPanel").setBusy(false);
                if (!oRefresh) {
                    sap.m.MessageToast.show(oBundle.getText("errorRefrescarSlots"));
                    return;
                }

                var aAllSlots = oRefresh.allSlots;

                // Localizar slot por MAT!LOTE en el pool global
                var iIndex = -1;
                for (var k = 0; k < aAllSlots.length; k++) {
                    if (!aAllSlots[k].value) { continue; }
                    if (aAllSlots[k].value.toUpperCase().split("!").slice(0, 2).join("!") === sMaterialLoteRef) {
                        iIndex = k;
                        break;
                    }
                }
                if (iIndex === -1) {
                    sap.m.MessageToast.show(oBundle.getText("sinLotes"));
                    return;
                }

                // Rebuild value: MAT!LOTE!NUEVA_CANTIDAD!NO_CARGA!CANTIDAD_PENDIENTE
                var sCantidadFormatted = nNewCantidad.toFixed(2);
                var currentParts = aAllSlots[iIndex].value.split("!");
                var sNoCargaAdd = currentParts.length >= 4 ? currentParts[3] : (currentParts[2] || "");
                aAllSlots[iIndex].cantidadAsignada = sCantidadFormatted;
                aAllSlots[iIndex].value = currentParts[0] + "!" + currentParts[1] + "!" + sCantidadFormatted + "!" + sNoCargaAdd + "!" + sCantidadFormatted;

                // Re-repartir slots entre ambas tablas
                var aSlotsCin = aAllSlots.slice(0, oRefresh.iQtyCin);
                var aSlotsAlm = aAllSlots.slice(oRefresh.iQtyCin, oRefresh.iQtyCin + oRefresh.iQtyAlm);
                var oTableCin = oView.byId("idSlotTableCintas");
                var oTableAlm = oView.byId("idSlotTableAlambre");
                if (oTableCin) { oTableCin.setModel(new sap.ui.model.json.JSONModel({ ITEMS: aSlotsCin })); }
                if (oTableAlm) { oTableAlm.setModel(new sap.ui.model.json.JSONModel({ ITEMS: aSlotsAlm })); }
                self._updateOrderSummaryScannedQty(aSlotsCin, aSlotsAlm);

                // Merge y POST al backend
                var slotTipo = oView.byId("slotType").getValue();
                var aEdited = [
                    { attribute: "SLOTTIPO",             value: slotTipo },
                    { attribute: "CINTAS_EF02_SLOTQTY",  value: oRefresh.iQtyCin.toString() },
                    { attribute: "ALAMBRE_EF02_SLOTQTY", value: oRefresh.iQtyAlm.toString() }
                ].concat(aAllSlots.map(function (slot) { return { attribute: slot.attribute, value: slot.value }; }));

                var oSapApi = self.getPublicApiRestDataSourceUri();
                var sParams = { plant: oPODParams.PLANT_ID, workCenter: oPODParams.WORK_CENTER };

                self.getWorkCenterCustomValues(sParams, oSapApi).then(function (oOriginalRes) {
                    var aOriginal = self._getValidatedCustomValues(oOriginalRes, oBundle);
                    if (!aOriginal) { return; }

                    var editedMap = {};
                    aEdited.forEach(function (item) { editedMap[item.attribute] = item.value; });

                    var aFinal = aOriginal.map(function (item) {
                        return { attribute: item.attribute, value: editedMap.hasOwnProperty(item.attribute) ? editedMap[item.attribute] : item.value };
                    });
                    for (var key in editedMap) {
                        if (!aFinal.find(function (i) { return i.attribute === key; })) {
                            aFinal.push({ attribute: key, value: editedMap[key] });
                        }
                    }

                    self.setCustomValuesPp({
                        inCustomValues: aFinal,
                        inPlant: oPODParams.PLANT_ID,
                        inWorkCenter: oPODParams.WORK_CENTER
                    }, oSapApi).then(function () {
                        sap.m.MessageToast.show(oBundle.getText("cantidadActualizada"));
                    }).catch(function () {
                        sap.m.MessageToast.show(oBundle.getText("errorActualizarSlot"));
                    });
                });
            }.bind(this));
        },

        onAfterRendering: function () {
            this.onGetCustomValues();
            this.onGetOrderCustomValues();
            this.setOrderSummary();
        },
        _getCurrentOperationStatus: function () {
            var oPodSelectionModel = this.getPodSelectionModel();
            var sCurrentStatus = "";


            if (oPodSelectionModel && oPodSelectionModel.selectedPhaseData) {
                sCurrentStatus = oPodSelectionModel.selectedPhaseData.status || "";
            }

            if (!sCurrentStatus) {
                var operation = (oPodSelectionModel && typeof oPodSelectionModel.getOperation === "function")
                    ? (oPodSelectionModel.getOperation() && oPodSelectionModel.getOperation().operation)
                    : null;
                if (!operation && gOperationPhase && gOperationPhase.operation) {
                    operation = gOperationPhase.operation.operation || gOperationPhase.operation;
                }
                if (operation) {
                    sCurrentStatus = operation.status || operation.operationStatus || "";
                }
            }

            if (!sCurrentStatus && gOperationPhase) {
                sCurrentStatus = gOperationPhase.status || "";
            }

            return sCurrentStatus;
        },
        onGetBOMData: function () {
            // Replaced by setOrderSummary() — kept as no-op for compatibility
        },

        _formatLoteQty: function (vCantidad) {
            var n = parseFloat(vCantidad);
            return isNaN(n) ? "" : n.toFixed(2);
        },

        summarizeByErpSequence: function (aComponents) {
            var mGroups = {};
            var aOrder = [];
            aComponents.forEach(function (oComp) {
                // Agrupar por material para sumar totalQuantity de todos los componentes del mismo material
                var sKey = (oComp.material && oComp.material.material)
                    ? String(oComp.material.material)
                    : (oComp.erpSequence !== undefined && oComp.erpSequence !== null
                        ? String(oComp.erpSequence) : String(oComp.sequence));
                if (!mGroups[sKey]) {
                    mGroups[sKey] = {
                        erpSequence: oComp.erpSequence, sequence: oComp.sequence,
                        material: oComp.material, unitOfMeasure: oComp.unitOfMeasure,
                        componentType: oComp.componentType,
                        quantity: 0, totalQuantity: 0
                    };
                    aOrder.push(sKey);
                }
                // Mantener la secuencia mínima del grupo
                if (oComp.sequence < mGroups[sKey].sequence) {
                    mGroups[sKey].sequence = oComp.sequence;
                }
                mGroups[sKey].quantity += Number(oComp.quantity || 0);
                mGroups[sKey].totalQuantity += Number(oComp.totalQuantity || 0);
            });
            return aOrder.map(function (sKey) { return mGroups[sKey]; });
        },

        setOrderSummary: function () {
            var oPODParams = this.Commons.getPODParams(this.getOwnerComponent());
            var oSapApi = this.getPublicApiRestDataSourceUri();
            var oBundle = this.getView().getModel("i18n").getResourceBundle();
            var oParams = {
                plant: oPODParams.PLANT_ID,
                bom: oPODParams.BOM_ID,
                type: "SHOP_ORDER"
            };

            this.getOrderSummary(oParams, oSapApi)
                .then(function (data) {
                    var oBomData = Array.isArray(data) ? data[0] : data;
                    var aComponents = (oBomData && Array.isArray(oBomData.components)) ? oBomData.components : [];
                    var aNormalComponents = aComponents.filter(function (oComp) {
                        return oComp && oComp.componentType === "NORMAL";
                    });

                    if (aNormalComponents.length === 0) {
                        console.warn("[OrderSummary] No se encontró componente NORMAL en BOM");
                        return;
                    }

                    var aGrouped = this.summarizeByErpSequence(aNormalComponents);
                    aGrouped.sort(function (a, b) { return (a.erpSequence || 0) - (b.erpSequence || 0); });

                    // Guardar componentes KG con lotes individuales asignados en BOM para el fragmento
                    this._aBomComponentesKg = aNormalComponents.filter(function (oComp) {
                        return (oComp.unitOfMeasure || "").toUpperCase() === "KG"
                            && oComp.batchNumber && oComp.batchNumber.trim() !== "";
                    });

                    var oOrderSummaryModel = this.getView().getModel("orderSummary");

                    // CINTAS principal: UoM "KG" (Cinta RC = peso en kg).
                    // ALAMBRE secundario: UoM "M" (Alambre = metros de alambre).
                    var oCompCintas = aGrouped.find(function (g) { return (g.unitOfMeasure || "").toUpperCase() === "KG"; })
                        || aGrouped[0] || {};

                    var oCompAlambre = aGrouped.find(function (g) {
                        return g !== oCompCintas && (g.unitOfMeasure || "").toUpperCase() === "M";
                    }) || aGrouped.find(function (g) {
                        return g !== oCompCintas;
                    }) || null;

                    var sMaterial1 = (oCompCintas.material && oCompCintas.material.material) || "";
                    var sMaterial2 = oCompAlambre ? ((oCompAlambre.material && oCompAlambre.material.material) || "") : "";

                    oOrderSummaryModel.setProperty("/material", sMaterial1);
                    oOrderSummaryModel.setProperty("/cantidadNecesaria", Number(oCompCintas.totalQuantity || 0));
                    oOrderSummaryModel.setProperty("/cantidadConsumida", 0);
                    oOrderSummaryModel.setProperty("/unidadMedida", oCompCintas.unitOfMeasure || "");

                    if (oCompAlambre) {
                        oOrderSummaryModel.setProperty("/material2", sMaterial2);
                        oOrderSummaryModel.setProperty("/cantidadNecesaria2", Number(oCompAlambre.totalQuantity || 0));
                        oOrderSummaryModel.setProperty("/cantidadConsumida2", 0);
                        oOrderSummaryModel.setProperty("/unidadMedida2", oCompAlambre.unitOfMeasure || "");
                    }

                    var aPromesas = [
                        this.getHeaderMaterial({ material: sMaterial1, plant: oPODParams.PLANT_ID }, oSapApi),
                        oCompAlambre
                            ? this.getHeaderMaterial({ material: sMaterial2, plant: oPODParams.PLANT_ID }, oSapApi)
                            : Promise.resolve(null)
                    ];

                    Promise.all(aPromesas)
                        .then(function (headerData) {
                            var oHeader1 = Array.isArray(headerData[0]) ? headerData[0][0] : headerData[0];
                            var oHeader2 = Array.isArray(headerData[1]) ? headerData[1][0] : headerData[1];

                            var descripcion1 = (oHeader1 && oHeader1.description) || "";
                            var descripcion2 = (oHeader2 && oHeader2.description) || "";

                            oOrderSummaryModel.setProperty("/descripcion", descripcion1);
                            oOrderSummaryModel.setProperty("/labelCintas", "CINTAS" + (descripcion1 ? " - " + descripcion1 : (sMaterial1 ? " - " + sMaterial1 : "")));
                            if (oCompAlambre) {
                                oOrderSummaryModel.setProperty("/descripcion2", descripcion2);
                                oOrderSummaryModel.setProperty("/labelAlambre", "ALAMBRE" + (descripcion2 ? " - " + descripcion2 : (sMaterial2 ? " - " + sMaterial2 : "")));
                            } else {
                                oOrderSummaryModel.setProperty("/descripcion2", "");
                                oOrderSummaryModel.setProperty("/labelAlambre", "ALAMBRE");
                            }

                            // Encadenar consulta de cantidad consumida (GoodsIssue)
                            return this.getGoodsIssueSummary({
                                plant: oPODParams.PLANT_ID,
                                order: oPODParams.ORDER_ID,
                                sfc: oPODParams.SFC,
                                operationActivity: oPODParams.OPERATION_ACTIVITY,
                                stepId: oPODParams.STEP_ID
                            }, oSapApi).catch(function () { return null; });
                        }.bind(this))
                        .then(function (oGoodsData) {
                            // Mapear cantidadConsumida por material desde lineItems
                            var aLineItems = (oGoodsData && Array.isArray(oGoodsData.lineItems)) ? oGoodsData.lineItems : [];
                            var oConsumoMap = {};
                            aLineItems.forEach(function (oItem) {
                                var sMat = (oItem.materialId && oItem.materialId.material) || "";
                                var nConsumo = (oItem.consumedQuantity && oItem.consumedQuantity.value) || 0;
                                if (sMat) { oConsumoMap[sMat.toUpperCase()] = nConsumo; }
                            });
                            oOrderSummaryModel.setProperty("/cantidadConsumida", oConsumoMap[(sMaterial1 || "").toUpperCase()] || 0);
                            if (oCompAlambre) {
                                oOrderSummaryModel.setProperty("/cantidadConsumida2", oConsumoMap[(sMaterial2 || "").toUpperCase()] || 0);
                            }

                            var oView = this.getView();
                            var aItemsCin = (oView.byId("idSlotTableCintas") && oView.byId("idSlotTableCintas").getModel())
                                ? oView.byId("idSlotTableCintas").getModel().getProperty("/ITEMS") : [];
                            var aItemsAlm = (oView.byId("idSlotTableAlambre") && oView.byId("idSlotTableAlambre").getModel())
                                ? oView.byId("idSlotTableAlambre").getModel().getProperty("/ITEMS") : [];
                            this._updateOrderSummaryScannedQty(aItemsCin, aItemsAlm);
                        }.bind(this))
                        .catch(function (error) {
                            console.error("[OrderSummary] Error obteniendo descripciones:", error);
                            sap.m.MessageToast.show(oBundle.getText("errorObtenerHeaderMaterial", [""]));
                        }.bind(this));
                }.bind(this))
                .catch(function (error) {
                    console.error("[OrderSummary] Error:", error);
                    sap.m.MessageToast.show(oBundle.getText("errorObtenerBom", [oPODParams.ORDER_ID || ""]));
                }.bind(this));
        },

        _updateOrderSummaryScannedQty: function (aItemsCintas, aItemsAlambre) {
            var oOrderSummaryModel = this.getView().getModel("orderSummary");
            if (!oOrderSummaryModel) { return; }

            var fnSumQty = function (aItems) {
                var arr = Array.isArray(aItems) ? aItems : [];
                return arr.reduce(function (nTotal, oItem) {
                    if (!oItem || !oItem.value) { return nTotal; }
                    var nQty = parseFloat(oItem.cantidadAsignada);
                    if (isNaN(nQty)) { nQty = parseFloat(oItem.loteQty); }
                    return nTotal + (isNaN(nQty) ? 0 : nQty);
                }, 0);
            };

            oOrderSummaryModel.setProperty("/cantidadEscaneada",  Number(fnSumQty(aItemsCintas).toFixed(2)));
            oOrderSummaryModel.setProperty("/cantidadEscaneada2", Number(fnSumQty(aItemsAlambre).toFixed(2)));
        },

        onPressOpenFragmentList: function (oEvent) {
            var oView = this.getView();
            var oSource = oEvent.getSource();
            var oPODParams = this.Commons.getPODParams(this.getOwnerComponent());
            var oBundle = oView.getModel("i18n").getResourceBundle();
            var oOrderSummaryModel = oView.getModel("orderSummary");

            // Determinar grupo: primero por contexto de tabla (Button → Toolbar → Table),
            // con fallback a CustomData. Si no es ALAMBRE, fuerza CINTAS.
            var sGrupo = ((oSource.data("grupo") || "") + "").trim().toUpperCase();
            var oToolbar = oSource.getParent && oSource.getParent();      // Toolbar
            var oTableCtx = oToolbar && oToolbar.getParent && oToolbar.getParent(); // Table
            if (oTableCtx && oTableCtx.getId) {
                if (oTableCtx.getId() === oView.createId("idSlotTableCintas")) {
                    sGrupo = "CINTAS";
                } else if (oTableCtx.getId() === oView.createId("idSlotTableAlambre")) {
                    sGrupo = "ALAMBRE";
                }
            }
            if (sGrupo !== "ALAMBRE") {
                sGrupo = "CINTAS";
            }

            var sMaterial, nCantidadRequerida, sFragId, sDialogId;
            if (sGrupo === "CINTAS") {
                sMaterial          = oOrderSummaryModel ? oOrderSummaryModel.getProperty("/material")         : "";
                nCantidadRequerida = oOrderSummaryModel ? oOrderSummaryModel.getProperty("/cantidadNecesaria") : 0;
                sFragId   = oView.getId() + "--Cintas";
                sDialogId = "Cintas--batchListDialog";
            } else {
                sMaterial          = oOrderSummaryModel ? oOrderSummaryModel.getProperty("/material2")          : "";
                nCantidadRequerida = oOrderSummaryModel ? oOrderSummaryModel.getProperty("/cantidadNecesaria2") : 0;
                sFragId   = oView.getId();
                sDialogId = "batchListDialog";
            }

            if (!sMaterial) {
                sap.m.MessageToast.show(oBundle.getText("errorObtenerHeaderMaterial", [""]));
                return;
            }

            // CINTAS (KG): mostrar lotes directamente del BOM si hay lotes asignados
            if (sGrupo === "CINTAS" && this._aBomComponentesKg && this._aBomComponentesKg.length > 0) {
                // Obtener lotes ya escaneados en la tabla de cintas
                var oTableCinFrag = oView.byId("idSlotTableCintas");
                var aScannedCin = (oTableCinFrag && oTableCinFrag.getModel())
                    ? (oTableCinFrag.getModel().getProperty("/ITEMS") || []) : [];
                var oScannedCinSet = {};
                aScannedCin.forEach(function (slot) {
                    if (slot.value) {
                        oScannedCinSet[slot.value.toUpperCase().split("!").slice(0, 2).join("!")] = true;
                    }
                });

                var aItemsBom = this._aBomComponentesKg
                    .filter(function (oComp) {
                        var sMat = (oComp.material && oComp.material.material) || "";
                        var sLote = oComp.batchNumber || "";
                        return !oScannedCinSet[(sMat + "!" + sLote).toUpperCase()];
                    })
                    .map(function (oComp) {
                        var sMat = (oComp.material && oComp.material.material) || "";
                        var sLote = oComp.batchNumber || "";
                        var nQty = parseFloat(oComp.totalQuantity || 0);
                        return { MATERIAL: sMat, LOTE: sLote, CANTIDAD: nQty.toFixed(2), CODIGO: sMat + "!" + sLote };
                    });
                if (!this.byId(sDialogId)) {
                    Fragment.load({
                        id: sFragId,
                        name: "serviacero.custom.plugins.zpluginPutBatchWCEF02.zpluginPutBatchWCEF02.fragment.batchList",
                        controller: this
                    }).then(function (oPopover) {
                        oView.addDependent(oPopover);
                        oPopover.setModel(new JSONModel({ ITEMS: aItemsBom }));
                        oPopover.openBy(oSource);
                    });
                } else {
                    var oDialogBom = this.byId(sDialogId);
                    oDialogBom.setModel(new JSONModel({ ITEMS: aItemsBom }));
                    oDialogBom.openBy(oSource);
                }
                return;
            }

            // ALAMBRE (M) o CINTAS sin lotes en BOM: consultar inventario
            var oThis = this;
            if (!this.byId(sDialogId)) {
                Fragment.load({
                    id: sFragId,
                    name: "serviacero.custom.plugins.zpluginPutBatchWCEF02.zpluginPutBatchWCEF02.fragment.batchList",
                    controller: this
                }).then(function (oPopover) {
                    oView.addDependent(oPopover);
                    oPopover.openBy(oSource);
                    oThis.enlistarInventario(oPODParams.PLANT_ID, oPODParams.ORDER_ID, sMaterial, nCantidadRequerida, sDialogId);
                });
            } else {
                this.byId(sDialogId).openBy(oSource);
                this.enlistarInventario(oPODParams.PLANT_ID, oPODParams.ORDER_ID, sMaterial, nCantidadRequerida, sDialogId);
            }
        },

        enlistarInventario: function (sPlant, sOrden, sMaterial, nCantidadRequerida, sDialogId) {
            var oView = this.getView();
            var oSapApi = this.getPublicApiRestDataSourceUri();
            var oBundle = oView.getModel("i18n").getResourceBundle();
            var oPODParams = this.Commons.getPODParams(this.getOwnerComponent());
            var oDialog = this.byId(sDialogId || "batchListDialog");

            if (!oDialog) { return; }

            // Limpiar busy previo por si una llamada anterior quedó pendiente
            oDialog.setBusy(false);
            oDialog.setModel(new JSONModel({ ITEMS: [] }));
            oDialog.setBusy(true);

            var oParams = {
                inPlanta: sPlant,
                inOrden: sOrden,
                inMaterial: sMaterial
            };

            this.ajaxPostRequest(oSapApi + this.ApiPaths.getLotesMaterialStock, oParams,
                function (oRes) {
                    if (oDialog.bIsDestroyed) { return; }
                    oDialog.setBusy(false);
                    var aData = Array.isArray(oRes) ? oRes
                        : (Array.isArray(oRes && oRes.stockResponse) ? oRes.stockResponse
                            : (Array.isArray(oRes && oRes.outLotes) ? oRes.outLotes
                                : (Array.isArray(oRes && oRes.content) ? oRes.content : [])));

                    var aItems = aData.map(function (oItem) {
                        var sMat = oItem.material;
                        var sLote = oItem.batchNumber;
                        var nCantidad = parseFloat((oItem.quantityOnHand && oItem.quantityOnHand.value) || 0);
                        return {
                            MATERIAL: sMat,
                            LOTE: sLote,
                            CANTIDAD: nCantidad.toFixed(2),
                            CODIGO: sMat + "!" + sLote
                        };
                    });

                    // Filtrar lotes ya escaneados en la tabla correspondiente
                    var sTableId = (sDialogId === "Cintas--batchListDialog") ? "idSlotTableCintas" : "idSlotTableAlambre";
                    var oScannedTable = oView.byId(sTableId);
                    var aScannedItems = (oScannedTable && oScannedTable.getModel())
                        ? (oScannedTable.getModel().getProperty("/ITEMS") || []) : [];
                    var oScannedSet = {};
                    aScannedItems.forEach(function (slot) {
                        if (slot.value) {
                            oScannedSet[slot.value.toUpperCase().split("!").slice(0, 2).join("!")] = true;
                        }
                    });
                    aItems = aItems.filter(function (oItem) {
                        return !oScannedSet[(oItem.MATERIAL + "!" + oItem.LOTE).toUpperCase()];
                    });

                    oDialog.setModel(new JSONModel({ ITEMS: aItems }));
                }.bind(this),
                function () {
                    if (oDialog.bIsDestroyed) { return; }
                    oDialog.setBusy(false);
                    sap.m.MessageToast.show(oBundle.getText("errorObtenerDatosOriginales") || "Error al obtener lotes");
                }.bind(this)
            );
        },

        onConfirmSendBatchChars: function (oEvent) {
            var oSource = oEvent.getSource();
            var oPopover = oSource.getParent ? oSource.getParent() : null;
            if (!oPopover || oPopover.bIsDestroyed) {
                // fallback: cerrar ambos si no se puede resolver desde evento
                var oCin = this.byId("Cintas--batchListDialog");
                var oAlm = this.byId("batchListDialog");
                if (oCin && !oCin.bIsDestroyed) { oCin.close(); }
                if (oAlm && !oAlm.bIsDestroyed) { oAlm.close(); }
            } else {
                oPopover.close();
            }
        },

        onCopiarCodigo: function (oEvent) {
            var oBundle = this.getView().getModel("i18n").getResourceBundle();
            var oContext = oEvent.getSource().getBindingContext();
            var sCodigo = oContext ? oContext.getProperty("CODIGO") : "";
            if (!sCodigo) { return; }
            navigator.clipboard.writeText(sCodigo).then(function () {
                sap.m.MessageToast.show(oBundle.getText("codigoCopiado", [sCodigo]));
            }).catch(function () {
                var oInput = document.createElement("input");
                oInput.value = sCodigo;
                document.body.appendChild(oInput);
                oInput.select();
                document.execCommand("copy");
                document.body.removeChild(oInput);
                sap.m.MessageToast.show(oBundle.getText("codigoCopiado", [sCodigo]));
            });
        },

        onCloseDialogBatchChars: function (oEvent) {
            var oSource = oEvent.getSource();
            // Button → OverflowToolbar (footer) → Popover
            var oToolbar = oSource.getParent ? oSource.getParent() : null;
            var oPopover = oToolbar && oToolbar.getParent ? oToolbar.getParent() : null;
            if (oPopover && !oPopover.bIsDestroyed) { oPopover.close(); }
        },

        onAfterClosePopoverInventario: function () {
            var oCin = this.byId("Cintas--batchListDialog");
            var oAlm = this.byId("batchListDialog");
            // Verificar isOpen() antes de limpiar busy:
            // evita la condición de carrera donde afterClose dispara después de que
            // el usuario ya re-abrió el dialog (y enlistarInventario ya puso setBusy(true))
            if (oCin && !oCin.bIsDestroyed && !oCin.isOpen()) { oCin.setBusy(false); }
            if (oAlm && !oAlm.bIsDestroyed && !oAlm.isOpen()) { oAlm.setBusy(false); }
        },

        getHeaderMaterial: function (sParams, oSapApi) {
            return new Promise(function (resolve, reject) {
                this.ajaxGetRequest(oSapApi + this.ApiPaths.HEADER_MATERIAL, sParams, function (oRes) {
                    resolve(oRes);
                }.bind(this), function (oRes) {
                    reject(oRes);
                }.bind(this));
            }.bind(this));
        },

        getOrderSummary: function (sParams, oSapApi) {
            return new Promise(function (resolve, reject) {
                this.ajaxGetRequest(oSapApi + this.ApiPaths.BOMS, sParams, function (oRes) {
                    resolve(oRes);
                }.bind(this), function (oRes) {
                    reject(oRes);
                }.bind(this));
            }.bind(this));
        },

        getGoodsIssueSummary: function (sParams, oSapApi) {
            return new Promise(function (resolve, reject) {
                this.ajaxGetRequest(oSapApi + this.ApiPaths.GOODSISSUES_SUMMARY, sParams, function (oRes) {
                    resolve(oRes);
                }.bind(this), function (oRes) {
                    reject(oRes);
                }.bind(this));
            }.bind(this));
        },

        onGetCustomValues: function () {
            var oView = this.getView();
            var oSapApi = this.getPublicApiRestDataSourceUri();
            var oPODParams = this.Commons.getPODParams(this.getOwnerComponent());
            var oParams = {
                plant: oPODParams.PLANT_ID,
                workCenter: oPODParams.WORK_CENTER
            };

            this.ajaxGetRequest(oSapApi + this.ApiPaths.WORKCENTERS, oParams, function (oRes) {
                var oData = Array.isArray(oRes) ? oRes[0] : oRes;
                if (!oData || !oData.customValues) {
                    console.error("No se encontraron customValues en la respuesta");
                    return;
                }

                var aCustomValues = oData.customValues;
                var noCargaSlot = aCustomValues.find(function (el) { return el.attribute === "NO_CARGA"; }) || { value: "0" };
                var tipoSlot = aCustomValues.find(function (el) { return el.attribute === "SLOTTIPO"; }) || { value: "" };
                var cvQtyCin = aCustomValues.find(function (el) { return el.attribute === "CINTAS_EF02_SLOTQTY"; }) || { value: "0" };
                var cvQtyAlm = aCustomValues.find(function (el) { return el.attribute === "ALAMBRE_EF02_SLOTQTY"; }) || { value: "0" };
                var iQtyCin = parseInt(cvQtyCin.value || "0", 10);
                var iQtyAlm = parseInt(cvQtyAlm.value || "0", 10);
                var iTotalSlots = iQtyCin + iQtyAlm;

                // Leer objetivos por carga (CARGA_1..CARGA_5) persistidos en los CV del puesto
                var self = this;
                ["1", "2", "3", "4", "5"].forEach(function (sCargaN) {
                    var oCargaCV = aCustomValues.find(function (el) { return el.attribute === "CARGA_" + sCargaN; });
                    if (oCargaCV && oCargaCV.value) {
                        var iCargaVal = parseInt(oCargaCV.value, 10);
                        if (!isNaN(iCargaVal) && iCargaVal > 0) { self._cargaTargets[sCargaN] = iCargaVal; }
                    }
                });

                // Construir mapa número → slot para posicionamiento exacto.
                // Si el EM elimina CVs de cintas vacías, los huecos se rellenan con
                // placeholders para que el split posicional (slice) sea siempre correcto:
                // SLOT001 → índice 0, SLOT002 → índice 1, ..., SLOT121 → índice 120, etc.
                var aAllSlots = aCustomValues.filter(function (item) {
                    return /^SLOT\d{3}$/.test(item.attribute);
                });
                var oSlotByNum = {};
                aAllSlots.forEach(function (slot) {
                    oSlotByNum[parseInt(slot.attribute.replace("SLOT", ""), 10)] = slot;
                });
                var aSlotsFixed = [];
                for (var i = 1; i <= iTotalSlots; i++) {
                    aSlotsFixed.push(oSlotByNum[i] || { attribute: "SLOT" + i.toString().padStart(3, "0"), value: "" });
                }

                // Poblar cantidadAsignada desde el valor almacenado (formato MAT!LOTE!CANTIDAD!SEQ!CANTIDAD_PENDIENTE)
                aSlotsFixed.forEach(function (slot) {
                    if (slot.value) {
                        var parts = slot.value.split('!');
                        slot.cantidadAsignada = parts.length >= 4 ? (parts[2] || "") : "";
                    } else {
                        slot.cantidadAsignada = "";
                    }
                    slot.loteQty = slot.loteQty || "";
                    slot.loteUom = slot.loteUom || "";
                });

                // Repartir: primeros iQtyCin → cintas (ordenadas: ocupadas primero), siguientes iQtyAlm → alambre
                var aSlotsCin = this._sortSlotsForDisplay(aSlotsFixed.slice(0, iQtyCin));
                var aSlotsAlm = aSlotsFixed.slice(iQtyCin, iQtyCin + iQtyAlm);

                var oTableCin = oView.byId("idSlotTableCintas");
                var oTableAlm = oView.byId("idSlotTableAlambre");
                if (oTableCin) { oTableCin.setModel(new sap.ui.model.json.JSONModel({ ITEMS: aSlotsCin })); }
                if (oTableAlm) { oTableAlm.setModel(new sap.ui.model.json.JSONModel({ ITEMS: aSlotsAlm })); }

                // Actualizar inputs
                oView.byId("noCarga").setValue(noCargaSlot.value || "0");
                oView.byId("slotType").setValue(tipoSlot.value || "");
                oView.byId("slotQty_cintas").setValue(iQtyCin.toString());
                oView.byId("slotQty_alambre").setValue(iQtyAlm.toString());

                // slotQty visible muestra la cantidad de la tabla activa
                var sActiveKey = oView.byId("tableToggle").getSelectedKey() || "CINTAS";
                oView.byId("slotQty").setValue(sActiveKey === "CINTAS" ? iQtyCin.toString() : iQtyAlm.toString());

                this._updateProgressIndicator();
                this._updateOrderSummaryScannedQty(aSlotsCin, aSlotsAlm);

                // Pre-poblar slotQtyEditable con el objetivo confirmado de la carga actual
                var iCurrentNoCargaNum = parseInt(noCargaSlot.value || "1", 10) || 1;
                var iCurrentTarget = this._cargaTargets[iCurrentNoCargaNum.toString()];
                if (iCurrentTarget) {
                    oView.byId("slotQtyEditable").setValue(iCurrentTarget.toString());
                }

                // Auto-inicializar Carga 1 si NO_CARGA es 0/nulo (primera configuración del puesto)
                var iNoCargaActual = parseInt(noCargaSlot.value || "0", 10);
                if (iNoCargaActual <= 0) {
                    this._autoInitCargaIfNeeded();
                }
            }.bind(this));
        },
        /**
         * Refresca los slots desde backend, preservando cantidadAsignada/loteQty/loteUom del modelo actual.
         * Devuelve promesa con { slots, slotsCin, slotsAlm, allSlots, customValues, iQtyCin, iQtyAlm }
         */
        _refreshSlotsFromBackend: function () {
            var oView = this.getView();
            var oSapApi = this.getPublicApiRestDataSourceUri();
            var oTableCin = oView.byId("idSlotTableCintas");
            var oTableAlm = oView.byId("idSlotTableAlambre");
            var oPODParams = this.Commons.getPODParams(this.getOwnerComponent());
            var sParams = {
                plant: oPODParams.PLANT_ID,
                workCenter: oPODParams.WORK_CENTER
            };

            // Preservar loteQty, loteUom y cantidadAsignada del modelo actual (ambas tablas)
            var aCurrentCin = (oTableCin && oTableCin.getModel()) ? (oTableCin.getModel().getProperty("/ITEMS") || []) : [];
            var aCurrentAlm = (oTableAlm && oTableAlm.getModel()) ? (oTableAlm.getModel().getProperty("/ITEMS") || []) : [];
            var oLoteQtyMap = {};
            var oLoteUomMap = {};
            var oCantidadAsignadaMap = {};
            [].concat(aCurrentCin, aCurrentAlm).forEach(function (item) {
                if (item.value) {
                    var parts = item.value.split('!');
                    var key = parts.slice(0, 2).join('!').toUpperCase();
                    oLoteQtyMap[key] = item.loteQty || "";
                    oLoteUomMap[key] = item.loteUom || "";
                    oCantidadAsignadaMap[key] = item.cantidadAsignada || "";
                }
            });

            return this.getWorkCenterCustomValues(sParams, oSapApi).then(function (oData) {
                if (!oData || oData === "Error" || !oData.customValues) {
                    return null;
                }

                var aCustomValues = oData.customValues;
                var cvQtyCin = aCustomValues.find(function (el) { return el.attribute === "CINTAS_EF02_SLOTQTY"; }) || { value: "0" };
                var cvQtyAlm = aCustomValues.find(function (el) { return el.attribute === "ALAMBRE_EF02_SLOTQTY"; }) || { value: "0" };
                var iQtyCin = parseInt(cvQtyCin.value || "0", 10);
                var iQtyAlm = parseInt(cvQtyAlm.value || "0", 10);
                var iTotalSlots = iQtyCin + iQtyAlm;

                var aAllSlots = aCustomValues.filter(function (item) {
                    return /^SLOT\d{3}$/.test(item.attribute);
                });
                // Posicionamiento exacto por número: SLOT001 → índice 0, SLOT121 → índice 120, etc.
                // Huecos (CVs eliminados por EM) se rellenan con placeholders vacíos.
                var oSlotByNum = {};
                aAllSlots.forEach(function (slot) {
                    oSlotByNum[parseInt(slot.attribute.replace("SLOT", ""), 10)] = slot;
                });
                var aSlotsFixed = [];
                for (var i = 1; i <= iTotalSlots; i++) {
                    aSlotsFixed.push(oSlotByNum[i] || { attribute: "SLOT" + i.toString().padStart(3, "0"), value: "" });
                }

                // Restaurar campos del modelo anterior
                aSlotsFixed.forEach(function (slot) {
                    if (slot.value) {
                        var parts = slot.value.split('!');
                        var key = parts.slice(0, 2).join('!').toUpperCase();
                        slot.loteQty = oLoteQtyMap[key] || "";
                        slot.loteUom = oLoteUomMap[key] || "";
                        slot.cantidadAsignada = (parts.length >= 4 ? parts[2] : "") || oCantidadAsignadaMap[key] || "";
                    } else {
                        slot.loteQty = "";
                        slot.loteUom = "";
                        slot.cantidadAsignada = "";
                    }
                });

                // Repartir entre tablas (cintas ordenadas: ocupadas primero por número de carga, vacías al final)
                var aSlotsCin = this._sortSlotsForDisplay(aSlotsFixed.slice(0, iQtyCin));
                var aSlotsAlm = aSlotsFixed.slice(iQtyCin, iQtyCin + iQtyAlm);

                if (oTableCin) { oTableCin.setModel(new sap.ui.model.json.JSONModel({ ITEMS: aSlotsCin })); }
                if (oTableAlm) { oTableAlm.setModel(new sap.ui.model.json.JSONModel({ ITEMS: aSlotsAlm })); }

                var sActiveKey = oView.byId("tableToggle").getSelectedKey() || "CINTAS";
                return {
                    slots: sActiveKey === "CINTAS" ? aSlotsCin : aSlotsAlm,
                    slotsCin: aSlotsCin,
                    slotsAlm: aSlotsAlm,
                    allSlots: aSlotsFixed,
                    customValues: aCustomValues,
                    iQtyCin: iQtyCin,
                    iQtyAlm: iQtyAlm
                };
            }.bind(this));
        },
        /**
         * Botón "Iniciar Carga": solo aplica para CINTAS.
         * Usa la cantidad de CINTAS_EF02_SLOTQTY, valida que la carga actual esté completa,
         * incrementa NO_CARGA y vacía los slots de cintas.
         * El alambre persiste a través de las cargas.
         * @returns {void}
         */
        onInicioEscaneo: function () {
            var oView = this.getView();
            var oBundle = oView.getModel("i18n").getResourceBundle();

            var sCurrentStatus = this._getCurrentOperationStatus();
            if (sCurrentStatus !== OPERATION_STATUS.ACTIVE) {
                sap.m.MessageBox.error(oBundle.getText("verificarStatusOperacion"));
                return;
            }

            if (!this._suggestedQtyCintas || this._suggestedQtyCintas <= 0) {
                sap.m.MessageBox.warning(
                    oBundle.getText("sinCantidadSugerida"),
                    { title: oBundle.getText("sinCantidadSugeridaTitle") }
                );
                return;
            }

            // Validar que la carga actual esté completamente escaneada antes de iniciar la siguiente
            var sNoCargaActual = oView.byId("noCarga").getValue() || "0";
            var iNoCargaActual = parseInt(sNoCargaActual, 10) || 0;
            if (iNoCargaActual > 0) {
                var oTableCin = oView.byId("idSlotTableCintas");
                var aItemsCin = (oTableCin && oTableCin.getModel()) ? (oTableCin.getModel().getProperty("/ITEMS") || []) : [];
                var iEscActual = 0;
                aItemsCin.forEach(function (s) {
                    if (!s.value || !s.value.trim()) { return; }
                    var sCargaSlot = s.value.split("!")[3] || "1";
                    if (sCargaSlot === sNoCargaActual) { iEscActual++; }
                });
                var iTargetActual = this._cargaTargets[sNoCargaActual]
                    ? this._cargaTargets[sNoCargaActual]
                    : this._suggestedQtyCintas;
                if (iTargetActual > 0 && iEscActual < iTargetActual) {
                    sap.m.MessageBox.warning(
                        oBundle.getText("cargaActualIncompleta", [sNoCargaActual, iEscActual, iTargetActual])
                    );
                    return;
                }
            }

            this._iniciarNuevaCarga(this._suggestedQtyCintas);
        },
        /**
         * [Eliminado] — el flujo de Finalizar Carga fue removido del diseño.
         * Se mantiene como stub para no romper referencias antiguas.
         */
        onFinalizarCarga: function () {
            var oView = this.getView();
            var oBundle = oView.getModel("i18n").getResourceBundle();
            var oPODParams = this.Commons.getPODParams(this.getOwnerComponent());
            var oSapApi = this.getPublicApiRestDataSourceUri();
            var self = this;

            var oTableCin = oView.byId("idSlotTableCintas");
            var oTableAlm = oView.byId("idSlotTableAlambre");
            var aItemsCin = (oTableCin && oTableCin.getModel()) ? (oTableCin.getModel().getProperty("/ITEMS") || []) : [];
            var aItemsAlm = (oTableAlm && oTableAlm.getModel()) ? (oTableAlm.getModel().getProperty("/ITEMS") || []) : [];

            var iQtyCin = parseInt(oView.byId("slotQty_cintas").getValue() || "0", 10);
            var iQtyAlm = parseInt(oView.byId("slotQty_alambre").getValue() || "0", 10);
            var iTotalQty = iQtyCin + iQtyAlm;

            var iEscaneadosCin = aItemsCin.filter(function (s) { return s.value && s.value.trim(); }).length;
            var iEscaneadosAlm = aItemsAlm.filter(function (s) { return s.value && s.value.trim(); }).length;
            var iEscaneados = iEscaneadosCin + iEscaneadosAlm;
            var sNoCarga = oView.byId("noCarga").getValue() || "0";

            if (iTotalQty <= 0) {
                sap.m.MessageToast.show(oBundle.getText("finalizarCargaSinCarga"));
                return;
            }
            if (iEscaneados === 0) {
                sap.m.MessageBox.warning(
                    oBundle.getText("finalizarCargaSinLotes"),
                    { title: oBundle.getText("finalizarCargaTitulo") }
                );
                return;
            }

            oView.byId("idPluginPanel").setBusy(true);
            var sParams = { plant: oPODParams.PLANT_ID, workCenter: oPODParams.WORK_CENTER };

            this.getWorkCenterCustomValues(sParams, oSapApi).then(function (oCurrentRes) {
                var aCurrentCV = self._getValidatedCustomValues(oCurrentRes, oBundle);
                if (!aCurrentCV) { oView.byId("idPluginPanel").setBusy(false); return; }

                var aEdited = [
                    { attribute: "SLOTQTY_CIN", value: iEscaneadosCin.toString() },
                    { attribute: "SLOTQTY_ALM", value: iEscaneadosAlm.toString() }
                ];
                var aEditMap = {};
                aEdited.forEach(function (item) { aEditMap[item.attribute] = item.value; });

                var aFinal = aCurrentCV.map(function (item) {
                    return { attribute: item.attribute, value: aEditMap.hasOwnProperty(item.attribute) ? aEditMap[item.attribute] : item.value };
                });
                for (var key in aEditMap) {
                    if (!aFinal.find(function (i) { return i.attribute === key; })) {
                        aFinal.push({ attribute: key, value: aEditMap[key] });
                    }
                }

                self.setCustomValuesPp({ inCustomValues: aFinal, inPlant: oPODParams.PLANT_ID, inWorkCenter: oPODParams.WORK_CENTER }, oSapApi).then(function () {
                    oView.byId("idPluginPanel").setBusy(false);
                    oView.byId("slotQty_cintas").setValue(iEscaneadosCin.toString());
                    oView.byId("slotQty_alambre").setValue(iEscaneadosAlm.toString());
                    self._updateProgressIndicator();
                    sap.m.MessageBox.success(
                        oBundle.getText("finalizarCargaMensaje", [sNoCarga, iEscaneados, iTotalQty]),
                        { title: oBundle.getText("finalizarCargaTitulo") }
                    );
                    setTimeout(function () { self.onGetCustomValues(); }, 500);
                }).catch(function () {
                    oView.byId("idPluginPanel").setBusy(false);
                    sap.m.MessageToast.show(oBundle.getText("errorFinalizarCarga"));
                });
            }).catch(function () {
                oView.byId("idPluginPanel").setBusy(false);
                sap.m.MessageToast.show(oBundle.getText("errorObtenerDatos"));
            });
        },
        onBarcodeSubmit: function () {
            const oView = this.getView();
            const oInput = oView.byId("scanInput");
            const sBarcode = oInput.getValue().trim();
            const oPODParams = this.Commons.getPODParams(this.getOwnerComponent());
            var oBundle = this.getView().getModel("i18n").getResourceBundle();

            if (!sBarcode) {
                return;
            }

            // Usar la tabla activa según el SegmentedButton
            var oTable = this._getActiveTable();
            var oModel = oTable.getModel();
            var aItems = oModel ? (oModel.getProperty("/ITEMS") || []) : [];

            var sNormalizado = sBarcode.toUpperCase();
            var partsBarcode = sNormalizado.split('!');

            if (partsBarcode.length < 2 || !partsBarcode[0] || !partsBarcode[1]) {
                sap.m.MessageToast.show(oBundle.getText("batchNotExists"));
                oInput.setValue(""); oInput.focus();
                return;
            }
            var loteExtraido = partsBarcode[1].trim();
            var materialExtraido = partsBarcode[0].trim();

            this._validarMaterialYLote(loteExtraido, materialExtraido);
        },
        /**
        * Funcion del boton "clear" con fragmento de confirmacion para limpiar la tabla y actualizar los customValues  
        * @returns {string} - funcion clearModel
        */
        onPressClear: function () {
            const oView = this.getView(),
                oResBun = oView.getModel("i18n").getResourceBundle();
            this.Commons.showConfirmDialog(function () {
                this.clearModel();
            }.bind(this), null, oResBun.getText("clearWarningMessage"));
        },
        clearModel: function () {
            var oView = this.getView();
            var oScanInput = oView.byId("scanInput");
            var oPODParams = this.Commons.getPODParams(this.getOwnerComponent());
            var oBundle = oView.getModel("i18n").getResourceBundle();
            var self = this;

            // Construir pool completo con ambas tablas
            var oTableCin = oView.byId("idSlotTableCintas");
            var oTableAlm = oView.byId("idSlotTableAlambre");
            var aSlotsCin = (oTableCin && oTableCin.getModel()) ? (oTableCin.getModel().getProperty("/ITEMS") || []) : [];
            var aSlotsAlm = (oTableAlm && oTableAlm.getModel()) ? (oTableAlm.getModel().getProperty("/ITEMS") || []) : [];

            var bHayLotes = aSlotsCin.some(function (s) { return s.value && s.value.trim(); }) ||
                            aSlotsAlm.some(function (s) { return s.value && s.value.trim(); });
            if (!bHayLotes) {
                sap.m.MessageToast.show(oBundle.getText("noDataToClear"));
                return;
            }

            // Vaciar valores de AMBAS tablas manteniendo atributos y filas fijas
            aSlotsCin.forEach(function (item) { item.value = ""; item.loteQty = ""; item.loteUom = ""; item.cantidadAsignada = ""; });
            aSlotsAlm.forEach(function (item) { item.value = ""; item.loteQty = ""; item.loteUom = ""; item.cantidadAsignada = ""; });
            if (oTableCin && oTableCin.getModel()) { oTableCin.getModel().setProperty("/ITEMS", aSlotsCin); oTableCin.getModel().refresh(true); }
            if (oTableAlm && oTableAlm.getModel()) { oTableAlm.getModel().setProperty("/ITEMS", aSlotsAlm); oTableAlm.getModel().refresh(true); }
            oScanInput.setValue("");
            oScanInput.focus();
            this._updateProgressIndicator();
            this._updateOrderSummaryScannedQty(aSlotsCin, aSlotsAlm);

            var aAllSlots = [].concat(aSlotsCin, aSlotsAlm);
            var slotTipo = oView.byId("slotType").getValue();
            // SLOTQTY y NO_CARGA se conservan; solo se vacían los valores de los slots
            var aEdited = [
                { attribute: "SLOTTIPO", value: slotTipo }
            ].concat(aAllSlots.map(function (slot) { return { attribute: slot.attribute, value: slot.value }; }));

            var oSapApi = this.getPublicApiRestDataSourceUri();
            var sParams = { plant: oPODParams.PLANT_ID, workCenter: oPODParams.WORK_CENTER };

            this.getWorkCenterCustomValues(sParams, oSapApi).then(function (oOriginalRes) {
                var aOriginal = self._getValidatedCustomValues(oOriginalRes, oBundle);
                if (!aOriginal) { return; }

                var aEditMap = {};
                aEdited.forEach(function (item) { aEditMap[item.attribute] = item.value; });

                var aFinal = aOriginal.map(function (item) {
                    return { attribute: item.attribute, value: aEditMap.hasOwnProperty(item.attribute) ? aEditMap[item.attribute] : item.value };
                });
                for (var key in aEditMap) {
                    if (!aFinal.find(function (i) { return i.attribute === key; })) {
                        aFinal.push({ attribute: key, value: aEditMap[key] });
                    }
                }

                self.setCustomValuesPp({
                    inCustomValues: aFinal,
                    inPlant: oPODParams.PLANT_ID,
                    inWorkCenter: oPODParams.WORK_CENTER
                }, oSapApi).then(function () {
                    sap.m.MessageToast.show(oBundle.getText("dataClearedSuccess"));
                }).catch(function () {
                    sap.m.MessageToast.show(oBundle.getText("errorClearing"));
                });
            }).catch(function () {
                sap.m.MessageToast.show(oBundle.getText("errorObtenerDatos"));
            });
        },
        /**
        * Llamada al Pp(getReservas) para obtener los lotes en Reserva y hacer validacion de material
        * @param {string} sLote - Valor del lote "material!lote" 
        * @param {string} sMaterial - Valor del material "material!lote" 
        * @returns {string} - Solo el material
        */
        _validarMaterialYLote: function (sLote, sMaterial) {
            const oView = this.getView();
            const oBundle = this.getView().getModel("i18n").getResourceBundle();
            const mandante = this.getConfiguration().mandante;
            const oPODParams = this.Commons.getPODParams(this.getOwnerComponent());
            const oInput = oView.byId("scanInput");
            const loteEscaneado = sLote;
            const materialEscaneado = sMaterial;

            const sCurrentStatus = this._getCurrentOperationStatus();
            if (sCurrentStatus !== OPERATION_STATUS.ACTIVE) {
                sap.m.MessageBox.error(oBundle.getText("verificarStatusOperacion"))
                return;
            }

            // validacion de material PRIMERO SE HACE LA DEL MATERIAL
            const urlMaterial = this.getPublicApiRestDataSourceUri() + this.ApiPaths.validateMaterialEnOrden;
            var inParamsMaterial = {
                "inPlanta": oPODParams.PLANT_ID,
                "inLote": loteEscaneado,
                "inOrden": oPODParams.ORDER_ID,
                "inMaterial": materialEscaneado
            };
            oView.byId("idPluginPanel").setBusy(true);

            this.ajaxPostRequest(urlMaterial, inParamsMaterial,
                // SUCCESS callback de validación de material
                function (oResMat) {
                    console.log("Respuesta material:", oResMat);
                    const matOk = oResMat && (oResMat.outMaterial === true || oResMat.outMaterial === "true");
                    const msgMat = (oResMat && oResMat.outMensaje) || oBundle.getText("materialNoValido");

                    if (!matOk) {
                        oView.byId("idPluginPanel").setBusy(false);
                        sap.m.MessageToast.show(msgMat);
                        oInput.setValue("");
                        oInput.focus();
                        this._slotContext = null;
                        return;
                    }

                    //Validacion de lotes  DESPUES DE LA DEL MATERIAL
                    var urlLote = this.getPublicApiRestDataSourceUri() + this.ApiPaths.getReservas;
                    var inParamsLote = {
                        "inPlanta": oPODParams.PLANT_ID,
                        "inLote": loteEscaneado,
                        "inOrden": oPODParams.ORDER_ID,
                        "inSapClient": mandante,
                        "inMaterial": materialEscaneado,
                        "inPuesto": oPODParams.WORK_CENTER
                    };

                    this.ajaxPostRequest(urlLote, inParamsLote,
                        // SUCCESS callback de validación de lote
                        function (oResponseData) {
                            oView.byId("idPluginPanel").setBusy(false);
                            console.log("Respuesta lote:", oResponseData);

                            var bEsValido = false;
                            if (oResponseData.outLote === "true" || oResponseData.outLote === true) {
                                bEsValido = true;
                            } else if (oResponseData.outLote === "false" || oResponseData.outLote === false) {
                                bEsValido = false;
                            }

                            if (bEsValido) {
                                const sCantidadLote = this._formatLoteQty(oResponseData.outCantidadLote);
                                const sUomLote = oResponseData.outOUMLote || "";
                                // Detectar de dónde vino el escaneo
                                if (!this._slotContext) {
                                    // Viene del input superior → buscar slot vacío
                                    // Pasar el barcode ya validado para evitar race condition con el input
                                    this._ejecutarUpdate(sCantidadLote, sUomLote, materialEscaneado + "!" + loteEscaneado);
                                } else {
                                    // Viene del botón por fila → actualizar ese slot
                                    this._slotContext.loteQty = sCantidadLote;
                                    this._slotContext.uom = sUomLote;
                                    this._procesarSlotValidado(sCantidadLote, sUomLote);
                                }
                            } else {
                                sap.m.MessageToast.show(oBundle.getText("loteNoValido"));
                                // Solo limpiar input si viene del input superior
                                if (!this._slotContext) {
                                    oInput.setValue("");
                                    oInput.focus();
                                }
                                // Limpiar contexto siempre
                                this._slotContext = null;
                            }
                        }.bind(this),
                        // ERROR callback de validación de lote
                        function (oError, sHttpErrorMessage) {
                            oView.byId("idPluginPanel").setBusy(false);
                            var err = oError || sHttpErrorMessage;
                            sap.m.MessageToast.show("Error al validar lote " + err);

                            // Solo limpiar input si viene del input superior
                            if (!this._slotContext) {
                                oInput.setValue("");
                                oInput.focus();
                            }
                            // Limpiar contexto siempre
                            this._slotContext = null;
                        }.bind(this)
                    );
                }.bind(this),
                // ERROR callback de validación de material
                function (oError, sHttpErrorMessage) {
                    oView.byId("idPluginPanel").setBusy(false);
                    sap.m.MessageToast.show(oBundle.getText("errorValidacion") || ("Error validación material: " + (sHttpErrorMessage || "")));
                    // Solo limpiar input si viene del input superior
                    if (!this._slotContext) {
                        oInput.setValue("");
                        oInput.focus();
                    }
                    // Limpiar contexto siempre
                    this._slotContext = null;
                }.bind(this)
            );
        },
        _ejecutarUpdate: function (sCantidadLote, sUom, sBarcodeIn) {
            var oView = this.getView();
            var oInput = oView.byId("scanInput");
            // Usar el barcode pasado como parámetro (capturado antes de la validación async)
            // para evitar race condition si el input es limpiado mientras se valida.
            var sBarcode = sBarcodeIn || oInput.getValue().trim();
            var oPODParams = this.Commons.getPODParams(this.getOwnerComponent());
            var oBundle = oView.getModel("i18n").getResourceBundle();
            var self = this;

            // Enrutar por material del lote escaneado (Cintas vs Alambre)
            // independientemente del tab activo, para evitar que lotes de Alambre
            // queden almacenados en slots de Cintas y viceversa.
            var oOrderSummaryModel = oView.getModel("orderSummary");
            var sMaterialAlambre = oOrderSummaryModel
                ? (oOrderSummaryModel.getProperty("/material2") || "").trim().toUpperCase() : "";
            var sEscaneadoMat = sBarcode.toUpperCase().split("!")[0].trim();
            var sTargetKey = (sMaterialAlambre && sEscaneadoMat === sMaterialAlambre) ? "ALAMBRE" : "CINTAS";

            // Refrescar slots desde backend antes de operar (evitar datos obsoletos)
            this._refreshSlotsFromBackend().then(function (oRefresh) {
                if (!oRefresh) {
                    sap.m.MessageToast.show(oBundle.getText("errorRefrescarSlots"));
                    oInput.setValue(""); oInput.focus();
                    return;
                }

                // Slots de la tabla destino (por material, no por tab activo)
                var aItems = sTargetKey === "CINTAS" ? oRefresh.slotsCin : oRefresh.slotsAlm;

                var sNormalizado = sBarcode.toUpperCase();
                var partsEscaneado = sNormalizado.split('!');
                var materialLoteEscaneado = partsEscaneado.slice(0, 2).join('!');

                // Verificar duplicado en la tabla destino
                var oExiste = aItems.find(function (Item) {
                    var valorItem = (Item.value || "").toString().trim().toUpperCase();
                    if (!valorItem) return false;
                    return valorItem.split('!').slice(0, 2).join('!') === materialLoteEscaneado;
                });
                if (oExiste) {
                    var sLoteDisplay = sBarcode.split("!")[1] || sBarcode;
                    sap.m.MessageToast.show(oBundle.getText("barcodeExists", [sLoteDisplay, oExiste.attribute]));
                    oInput.setValue(""); oInput.focus();
                    return;
                }

                // Encontrar primer slot vacío en la tabla destino
                var oEmptySlot = aItems.find(function (item) { return !item.value || item.value === ""; });
                if (oEmptySlot) {
                    var sNoCargaEsc = oView.byId("noCarga").getValue() || "1";
                    var sCantidadPendInit = sCantidadLote || "0.00";
                    oEmptySlot.value = sBarcode + "!" + (sCantidadLote || "0.00") + "!" + sNoCargaEsc + "!" + sCantidadPendInit;
                    oEmptySlot.loteQty = sCantidadLote || "";
                    oEmptySlot.loteUom = sUom || "";
                    oEmptySlot.cantidadAsignada = sCantidadLote || "";

                    // Actualizar el modelo de la tabla destino
                    var oActiveTable = sTargetKey === "CINTAS"
                        ? oView.byId("idSlotTableCintas")
                        : oView.byId("idSlotTableAlambre");
                    oActiveTable.getModel().setProperty("/ITEMS", aItems);
                    oActiveTable.getModel().refresh(true);
                    self._updateProgressIndicator();
                    var aUpdCin = sTargetKey === "CINTAS" ? aItems : oRefresh.slotsCin;
                    var aUpdAlm = sTargetKey === "ALAMBRE" ? aItems : oRefresh.slotsAlm;
                    self._updateOrderSummaryScannedQty(aUpdCin, aUpdAlm);
                } else {
                    sap.m.MessageToast.show(oBundle.getText("sinLotes"));
                    return;
                }

                oInput.setValue(""); oInput.focus();

                // Construir lista de editados usando el pool completo (cintas + alambre)
                var slotTipo = oView.byId("slotType").getValue();
                var aEdited = [
                    { attribute: "SLOTTIPO", value: slotTipo },
                    { attribute: "CINTAS_EF02_SLOTQTY", value: oRefresh.iQtyCin.toString() },
                    { attribute: "ALAMBRE_EF02_SLOTQTY", value: oRefresh.iQtyAlm.toString() }
                ].concat(oRefresh.allSlots.map(function (slot) {
                    return { attribute: slot.attribute, value: slot.value };
                }));

                var oSapApi = self.getPublicApiRestDataSourceUri();
                var sParams = { plant: oPODParams.PLANT_ID, workCenter: oPODParams.WORK_CENTER };

                self.getWorkCenterCustomValues(sParams, oSapApi).then(function (oOriginalRes) {
                    var aOriginal = self._getValidatedCustomValues(oOriginalRes, oBundle);
                    if (!aOriginal) { return; }

                    var editedMap = {};
                    aEdited.forEach(function (item) { editedMap[item.attribute] = item.value; });

                    var aFinal = aOriginal.map(function (item) {
                        return { attribute: item.attribute, value: editedMap.hasOwnProperty(item.attribute) ? editedMap[item.attribute] : item.value };
                    });
                    for (var key in editedMap) {
                        if (!aFinal.find(function (i) { return i.attribute === key; })) {
                            aFinal.push({ attribute: key, value: editedMap[key] });
                        }
                    }

                    self.setCustomValuesPp({
                        inCustomValues: aFinal,
                        inPlant: oPODParams.PLANT_ID,
                        inWorkCenter: oPODParams.WORK_CENTER,
                        inMaterialLote: materialLoteEscaneado || ""
                    }, oSapApi).then(function () {
                        sap.m.MessageToast.show(oBundle.getText("slotActualizado"));
                        self._checkCargaCompleta();
                    }).catch(function () {
                        sap.m.MessageToast.show(oBundle.getText("errorActualizarSlot"));
                    });
                });
            });
        },
        onScanSuccess: function (oEvent) {
            if (oEvent.getParameter("cancelled")) {
                sap.m.MessageToast.show("Scan cancelled", { duration: 1000 });
            } else {
                if (oEvent.getParameter("text")) {
                    this.oScanInput.setValue(oEvent.getParameter("text"));
                    this.onBarcodeSubmit();
                } else {
                    this.oScanInput.setValue('');
                }
            }
        },
        onScanError: function (oEvent) {
            sap.m.MessageToast.show("Scan failed: " + oEvent, { duration: 1000 });
        },
        onScanLiveupdate: function (oEvent) {
            // Auto-submit al escanear con pistola física (USB/Bluetooth).
            // La pistola envía todos los caracteres en <150ms; si no llegan
            // más caracteres en 500ms se asume que el código está completo.
            clearTimeout(this._oScanDebounceTimer);
            var sValue = oEvent.getParameter("value") || "";
            if (!sValue) { return; }
            this._oScanDebounceTimer = setTimeout(function () {
                this.onBarcodeSubmit();
            }.bind(this), 300);
        },
        //funcion del boton #Eliminar-delete elimina un elemento de la tabla activa
        onDeleteSlot: function (oEvent) {
            var oView = this.getView();
            var oPODParams = this.Commons.getPODParams(this.getOwnerComponent());
            var oBundle = oView.getModel("i18n").getResourceBundle();
            var self = this;

            // Detectar en qué tabla está el botón (cintas o alambre)
            var oButton = oEvent.getSource();
            var oItem = oButton.getParent(); // ColumnListItem
            var oTable = oItem.getParent(); // Table
            var sCintasId = oView.createId("idSlotTableCintas");

            var oModel = oTable.getModel();
            var aSlots = oModel.getProperty("/ITEMS");
            var iIndex = oTable.indexOfItem(oItem);
            if (iIndex === -1) { return; }

            var sValueToDelete = aSlots[iIndex] ? (aSlots[iIndex].value || "") : "";
            var sMaterialLoteEliminado = sValueToDelete.split('!').slice(0, 2).join('!');

            // Recorrer los slots hacia arriba para rellenar el hueco
            for (var i = iIndex; i < aSlots.length - 1; i++) {
                aSlots[i].value = aSlots[i + 1].value;
                aSlots[i].loteQty = aSlots[i + 1].loteQty;
                aSlots[i].loteUom = aSlots[i + 1].loteUom;
                aSlots[i].cantidadAsignada = aSlots[i + 1].cantidadAsignada;
            }
            aSlots[aSlots.length - 1].value = "";
            aSlots[aSlots.length - 1].loteQty = "";
            aSlots[aSlots.length - 1].loteUom = "";
            aSlots[aSlots.length - 1].cantidadAsignada = "";

            oModel.setProperty("/ITEMS", aSlots);
            oModel.refresh(true);
            this._updateProgressIndicator();

            // Construir pool completo para el update
            var oTableCin = oView.byId("idSlotTableCintas");
            var oTableAlm = oView.byId("idSlotTableAlambre");
            var aSlotsCin = (oTableCin && oTableCin.getModel()) ? (oTableCin.getModel().getProperty("/ITEMS") || []) : [];
            var aSlotsAlm = (oTableAlm && oTableAlm.getModel()) ? (oTableAlm.getModel().getProperty("/ITEMS") || []) : [];
            var aAllSlots = [].concat(aSlotsCin, aSlotsAlm);

            // Re-sincronizar ambos modelos (NO_CARGA de cada slot se preserva sin renumerar)
            if (oTableCin && oTableCin.getModel()) { oTableCin.getModel().refresh(true); }
            if (oTableAlm && oTableAlm.getModel()) { oTableAlm.getModel().refresh(true); }
            self._updateOrderSummaryScannedQty(aSlotsCin, aSlotsAlm);

            var slotTipo = oView.byId("slotType").getValue();
            var iQtyCin = parseInt(oView.byId("slotQty_cintas").getValue() || "0", 10);
            var iQtyAlm = parseInt(oView.byId("slotQty_alambre").getValue() || "0", 10);
            var aEdited = [
                { attribute: "SLOTTIPO", value: slotTipo },
                { attribute: "CINTAS_EF02_SLOTQTY", value: iQtyCin.toString() },
                { attribute: "ALAMBRE_EF02_SLOTQTY", value: iQtyAlm.toString() }
            ].concat(aAllSlots.map(function (slot) { return { attribute: slot.attribute, value: slot.value }; }));

            var oSapApi = this.getPublicApiRestDataSourceUri();
            var sParams = { plant: oPODParams.PLANT_ID, workCenter: oPODParams.WORK_CENTER };

            this.getWorkCenterCustomValues(sParams, oSapApi).then(function (oOriginalRes) {
                var aOriginal = self._getValidatedCustomValues(oOriginalRes, oBundle);
                if (!aOriginal) { return; }

                var editedMap = {};
                aEdited.forEach(function (item) { editedMap[item.attribute] = item.value; });

                var aFinal = aOriginal.map(function (item) {
                    return { attribute: item.attribute, value: editedMap.hasOwnProperty(item.attribute) ? editedMap[item.attribute] : item.value };
                });
                for (var key in editedMap) {
                    if (!aFinal.find(function (i) { return i.attribute === key; })) {
                        aFinal.push({ attribute: key, value: editedMap[key] });
                    }
                }
                self.setCustomValuesPp({ inCustomValues: aFinal, inPlant: oPODParams.PLANT_ID, inWorkCenter: oPODParams.WORK_CENTER, inMaterialLote: sMaterialLoteEliminado || "" }, oSapApi).then(function () {
                    sap.m.MessageToast.show(oBundle.getText("loteEliminado"));
                }).catch(function () {
                    sap.m.MessageBox.error(oBundle.getText("errorActualizar"));
                });
            });
        },
        //
        onScanSlotSuccess: function (oEvent) {
            var oBundle = this.getView().getModel("i18n").getResourceBundle();

            if (oEvent.getParameter("cancelled")) {
                sap.m.MessageToast.show("Scan cancelled", { duration: 1000 });
                return;
            }
            var sBarcode = (oEvent.getParameter("text") || "").trim();
            if (!sBarcode) { return; }

            var parts = sBarcode.toUpperCase().split('!');
            if (parts.length < 2 || !parts[0] || !parts[1]) {
                sap.m.MessageToast.show(oBundle.getText("batchNotExists"));
                return;
            }

            var sMaterial = parts[0].trim();
            var sLote = parts[1].trim();

            // Detectar en qué tabla está el botón (cintas o alambre)
            var oButton = oEvent.getSource();
            var oItem = oButton.getParent();
            var oTable = oItem.getParent().getParent();
            var sCintasId = this.getView().createId("idSlotTableCintas");
            var sTableKey = (oTable.getId() === sCintasId) ? "CINTAS" : "ALAMBRE";

            // Guarda contexto para actualizar la fila cuando ambas validaciones pasen
            this._slotContext = { oEvent: oEvent, sBarcode: sBarcode, loteExtraido: sLote, sTableId: sTableKey };

            // Reutiliza la validación combinada
            this._validarMaterialYLote(sLote, sMaterial);
        },
        /**
         * Procesar slot específico validado (scan de botón de fila)
         */
        _procesarSlotValidado: function (sCantidadLote, sUom) {
            if (!this._slotContext) {
                console.error("No hay contexto de slot guardado");
                return;
            }

            var slotCtx = this._slotContext;
            var oEvent = slotCtx.oEvent;
            var sBarcode = slotCtx.sBarcode;
            var sTableKey = slotCtx.sTableId || "CINTAS";

            var oBundle = this.getView().getModel("i18n").getResourceBundle();
            var oPODParams = this.Commons.getPODParams(this.getOwnerComponent());
            var oView = this.getView();
            var self = this;

            // Obtener la tabla correcta según el contexto guardado
            var oTable = sTableKey === "CINTAS"
                ? oView.byId("idSlotTableCintas")
                : oView.byId("idSlotTableAlambre");

            var oButton = oEvent.getSource();
            var oItem = oButton.getParent();
            var iIndex = oTable.indexOfItem(oItem);
            var oModel = oTable.getModel();
            var aSlots = oModel.getProperty("/ITEMS");

            if (iIndex === -1 || !aSlots[iIndex]) { return; }

            var sNormalizado = sBarcode.toUpperCase();
            var partsEscaneado = sNormalizado.split('!');
            var materialLoteEscaneado = partsEscaneado.slice(0, 2).join('!');

            // Verificar duplicado en esta tabla
            var sExiste = aSlots.find(function (slot, idx) {
                if (idx === iIndex) { return false; }
                var valorSlot = (slot.value || "").toString().trim().toUpperCase();
                if (!valorSlot) return false;
                return valorSlot.split('!').slice(0, 2).join('!') === materialLoteEscaneado;
            });
            if (sExiste) {
                sap.m.MessageToast.show(oBundle.getText("barcodeExists", [sBarcode, sExiste.attribute]));
                this._slotContext = null;
                return;
            }

            // Si el valor ya es el mismo en esa fila, no actualizar
            var valorActual = (aSlots[iIndex].value || "").toString().trim().toUpperCase();
            if (valorActual && valorActual.split('!').slice(0, 2).join('!') === materialLoteEscaneado) {
                sap.m.MessageToast.show(oBundle.getText("sinCambios"));
                this._slotContext = null;
                return;
            }

            var sNoCargaProc = oView.byId("noCarga").getValue() || "1";
            var sCantidadPendProc = sCantidadLote || "0.00";
            aSlots[iIndex].value = sBarcode + "!" + (sCantidadLote || "0.00") + "!" + sNoCargaProc + "!" + sCantidadPendProc;
            aSlots[iIndex].loteQty = sCantidadLote || "";
            aSlots[iIndex].loteUom = sUom || "";
            aSlots[iIndex].cantidadAsignada = sCantidadLote || "";
            oModel.setProperty("/ITEMS", aSlots);
            oModel.refresh(true);
            this._updateProgressIndicator();

            // Construir pool completo para el update
            var oTableCin = oView.byId("idSlotTableCintas");
            var oTableAlm = oView.byId("idSlotTableAlambre");
            var aSlotsCin = (oTableCin && oTableCin.getModel()) ? (oTableCin.getModel().getProperty("/ITEMS") || []) : [];
            var aSlotsAlm = (oTableAlm && oTableAlm.getModel()) ? (oTableAlm.getModel().getProperty("/ITEMS") || []) : [];
            var aAllSlots = [].concat(aSlotsCin, aSlotsAlm);

            var slotTipo = oView.byId("slotType").getValue();
            var iQtyCin = parseInt(oView.byId("slotQty_cintas").getValue() || "0", 10);
            var iQtyAlm = parseInt(oView.byId("slotQty_alambre").getValue() || "0", 10);
            var aEdited = [
                { attribute: "SLOTTIPO", value: slotTipo },
                { attribute: "CINTAS_EF02_SLOTQTY", value: iQtyCin.toString() },
                { attribute: "ALAMBRE_EF02_SLOTQTY", value: iQtyAlm.toString() }
            ].concat(aAllSlots.map(function (slot) { return { attribute: slot.attribute, value: slot.value }; }));

            var oSapApi = this.getPublicApiRestDataSourceUri();
            var sParams = { plant: oPODParams.PLANT_ID, workCenter: oPODParams.WORK_CENTER };

            this.getWorkCenterCustomValues(sParams, oSapApi).then(function (oOriginalRes) {
                var aOriginal = self._getValidatedCustomValues(oOriginalRes, oBundle);
                if (!aOriginal) { self._slotContext = null; return; }

                var editedMap = {};
                aEdited.forEach(function (item) { editedMap[item.attribute] = item.value; });
                var aFinal = aOriginal.map(function (item) {
                    return { attribute: item.attribute, value: editedMap.hasOwnProperty(item.attribute) ? editedMap[item.attribute] : item.value };
                });
                for (var key in editedMap) {
                    if (!aFinal.find(function (i) { return i.attribute === key; })) {
                        aFinal.push({ attribute: key, value: editedMap[key] });
                    }
                }

                self.setCustomValuesPp({
                    inCustomValues: aFinal,
                    inPlant: oPODParams.PLANT_ID,
                    inWorkCenter: oPODParams.WORK_CENTER,
                    inMaterialLote: materialLoteEscaneado || ""
                }, oSapApi).then(function () {
                    sap.m.MessageToast.show(oBundle.getText("slotActualizado"));
                    self._slotContext = null;
                    self._checkCargaCompleta();
                }).catch(function () {
                    sap.m.MessageToast.show(oBundle.getText("errorActualizar"));
                    self._slotContext = null;
                });
            });
        },

        onBeforeRenderingPlugin: function () {
            var oPodSelectionModel = this.getPodSelectionModel();
            if (oPodSelectionModel && oPodSelectionModel.selectedPhaseData) {
                var sStatus = oPodSelectionModel.selectedPhaseData.status || "";
                gOperationPhase = {
                    status: sStatus
                };
            }

            this.subscribe("phaseSelectionEvent", this.onPhaseSelectionEventCustom, this);

        },
        onPhaseSelectionEventCustom: function (sChannelId, sEventId, oData) {
            if (this.isEventFiredByThisPlugin(oData)) {
                return;
            }
            gOperationPhase = oData;
            this.onGetCustomValues();
            this.onGetOrderCustomValues();
        },

        isSubscribingToNotifications: function () {

            var bNotificationsEnabled = true;

            return bNotificationsEnabled;
        },


        getCustomNotificationEvents: function (sTopic) {
            //return ["template"];
        },


        getNotificationMessageHandler: function (sTopic) {

            //if (sTopic === "template") {
            //    return this._handleNotificationMessage;
            //}
            return null;
        },

        _handleNotificationMessage: function (oMsg) {

            var sMessage = "Message not found in payload 'message' property";
            if (oMsg && oMsg.parameters && oMsg.parameters.length > 0) {
                for (var i = 0; i < oMsg.parameters.length; i++) {

                    switch (oMsg.parameters[i].name) {
                        case "template":

                            break;
                        case "template2":


                    }



                }
            }

        },
        getWorkCenterCustomValues: function (sParams, oSapApi) {
            return new Promise((resolve) => {
                this.ajaxGetRequest(oSapApi + this.ApiPaths.WORKCENTERS, sParams, function (oRes) {
                    const oData = Array.isArray(oRes) ? oRes[0] : oRes;
                    resolve(oData);
                }.bind(this),
                    function (oRes) {
                        // Error callback
                        resolve("Error");
                    }.bind(this));
            });
        },
        _getValidatedCustomValues: function (oResponseData, oBundle) {
            if (!oResponseData || oResponseData === "Error" || !Array.isArray(oResponseData.customValues)) {
                sap.m.MessageToast.show(oBundle.getText("errorObtenerDatos") || "Error al obtener customValues");
                return null;
            }
            return oResponseData.customValues;
        },
        setCustomValuesPp: function (oParams, oSapApi) {
            return new Promise((resolve) => {
                this.ajaxPostRequest(oSapApi + this.ApiPaths.putBatchSlotWorkCenter, oParams, function (oRes) {
                    resolve(oRes);
                }.bind(this),
                    function (oRes) {
                        // Error callback
                        resolve("Error");
                    }.bind(this));
            });
        },
        /**
         * Auto-inicializa la Carga 1 cuando CINTAS_EF02_SLOTQTY es 0.
         * Si la cantidad sugerida ya está disponible, llama _iniciarNuevaCarga directamente.
         * Si no, activa el flag _pendingAutoInit para que lo dispare onGetOrderCustomValues.
         */
        /**
         * Confirma el objetivo de cintas para la carga actual y lo persiste en el CV CARGA_N del puesto.
         * Lee el valor de slotQtyEditable (editable por el operador), valida y escribe en CARGA_N.
         * El compañero de EM/consumos puede consultar CARGA_1..CARGA_5 para conocer la cantidad exacta por carga.
         */
        onConfirmSuggestedQty: function () {
            var oView = this.getView();
            var oBundle = oView.getModel("i18n").getResourceBundle();
            var sVal = oView.byId("slotQtyEditable").getValue();
            var nNew = parseInt(sVal, 10);
            if (isNaN(nNew) || nNew <= 0) {
                sap.m.MessageToast.show(oBundle.getText("cantidadInvalida"));
                return;
            }
            var sNoCarga = oView.byId("noCarga").getValue() || "1";
            var sCargaAttr = "CARGA_" + sNoCarga;
            var oPODParams = this.Commons.getPODParams(this.getOwnerComponent());
            var oSapApi = this.getPublicApiRestDataSourceUri();
            var self = this;

            oView.byId("idPluginPanel").setBusy(true);
            var sParams = { plant: oPODParams.PLANT_ID, workCenter: oPODParams.WORK_CENTER };

            this.getWorkCenterCustomValues(sParams, oSapApi).then(function (oOriginalRes) {
                var aOriginal = self._getValidatedCustomValues(oOriginalRes, oBundle);
                if (!aOriginal) { oView.byId("idPluginPanel").setBusy(false); return; }

                // Merge: actualizar solo CARGA_N con el objetivo confirmado por el operador
                var editedMap = {};
                editedMap[sCargaAttr] = nNew.toString();
                var aFinal = aOriginal.map(function (item) {
                    return { attribute: item.attribute, value: editedMap.hasOwnProperty(item.attribute) ? editedMap[item.attribute] : item.value };
                });
                if (!aFinal.find(function (i) { return i.attribute === sCargaAttr; })) {
                    aFinal.push({ attribute: sCargaAttr, value: nNew.toString() });
                }

                self.setCustomValuesPp({
                    inCustomValues: aFinal,
                    inPlant: oPODParams.PLANT_ID,
                    inWorkCenter: oPODParams.WORK_CENTER
                }, oSapApi).then(function () {
                    oView.byId("idPluginPanel").setBusy(false);
                    self._suggestedQtyCintas = nNew;
                    self._cargaTargets[sNoCarga] = nNew;
                    self._updateProgressIndicator();
                    sap.m.MessageToast.show(oBundle.getText("objetivoCargaActualizado", [sNoCarga, nNew]));
                }).catch(function () {
                    oView.byId("idPluginPanel").setBusy(false);
                    sap.m.MessageToast.show(oBundle.getText("errorObtenerDatos"));
                });
            }).catch(function () {
                oView.byId("idPluginPanel").setBusy(false);
                sap.m.MessageToast.show(oBundle.getText("errorObtenerDatos"));
            });
        },

        /**
         * Ordena un array de slots para visualización: slots ocupados primero (agrupados
         * por número de carga ascendente, luego por atributo SLOT), slots vacíos al final.
         * No modifica los datos ni el backend; solo es visual.
         * @param {Array} aSlots - Array de objetos slot del modelo
         * @returns {Array} Array reordenado
         */
        _sortSlotsForDisplay: function (aSlots) {
            var aOccupied = aSlots.filter(function (s) { return s.value && s.value.trim(); });
            var aEmpty    = aSlots.filter(function (s) { return !s.value || !s.value.trim(); });
            aOccupied.sort(function (a, b) {
                var nA = parseInt((a.value.split("!")[3] || "0"), 10);
                var nB = parseInt((b.value.split("!")[3] || "0"), 10);
                if (nA !== nB) { return nA - nB; }
                return a.attribute.localeCompare(b.attribute);
            });
            return aOccupied.concat(aEmpty);
        },

        _autoInitCargaIfNeeded: function () {
            if (this._suggestedQtyCintas && this._suggestedQtyCintas > 0) {
                this._iniciarNuevaCarga(this._suggestedQtyCintas);
            } else {
                this._pendingAutoInit = true;
            }
        },

        /**
         * Iniciar nueva carga para CINTAS: incrementa NO_CARGA y actualiza CINTAS_EF02_SLOTQTY.
         * El alambre persiste a través de las cargas (no se resetea).
         * @param {number} iCantidad - Cantidad de cintas por carga
         */
        _iniciarNuevaCarga: function (iCantidad) {
            var oView = this.getView();
            var oBundle = oView.getModel("i18n").getResourceBundle();
            var oPODParams = this.Commons.getPODParams(this.getOwnerComponent());
            var oSapApi = this.getPublicApiRestDataSourceUri();
            var self = this;

            oView.byId("idPluginPanel").setBusy(true);
            var sParams = { plant: oPODParams.PLANT_ID, workCenter: oPODParams.WORK_CENTER };

            this.getWorkCenterCustomValues(sParams, oSapApi).then(function (oCurrentRes) {
                var aCurrentCV = self._getValidatedCustomValues(oCurrentRes, oBundle);
                if (!aCurrentCV) { oView.byId("idPluginPanel").setBusy(false); return; }

                // Incrementar NO_CARGA
                var oNoCargaCV = aCurrentCV.find(function (cv) { return cv.attribute === "NO_CARGA"; });
                var iNuevaCarga = (oNoCargaCV ? (parseInt(oNoCargaCV.value || "0", 10) || 0) : 0) + 1;

                // Incrementar NO_CARGA y guardar objetivo inicial de la nueva carga automáticamente
                var aEdited = [
                    { attribute: "NO_CARGA", value: iNuevaCarga.toString() },
                    { attribute: "CARGA_" + iNuevaCarga.toString(), value: iCantidad.toString() }
                ];

                var aEditMap = {};
                aEdited.forEach(function (item) { aEditMap[item.attribute] = item.value; });
                var aFinal = aCurrentCV.map(function (item) {
                    return { attribute: item.attribute, value: aEditMap.hasOwnProperty(item.attribute) ? aEditMap[item.attribute] : item.value };
                });
                for (var key in aEditMap) {
                    if (!aFinal.find(function (i) { return i.attribute === key; })) {
                        aFinal.push({ attribute: key, value: aEditMap[key] });
                    }
                }

                self.setCustomValuesPp({ inCustomValues: aFinal, inPlant: oPODParams.PLANT_ID, inWorkCenter: oPODParams.WORK_CENTER }, oSapApi).then(function () {
                    oView.byId("idPluginPanel").setBusy(false);
                    oView.byId("noCarga").setValue(iNuevaCarga.toString());
                    self._suggestedQtyCintas = iCantidad;
                    // Registrar objetivo de esta carga (guardado automáticamente al iniciar)
                    self._cargaTargets[iNuevaCarga.toString()] = iCantidad;
                    // Pre-poblar slotQtyEditable con el objetivo de la nueva carga
                    // (usa el confirmado previamente si existe, o el sugerido por la orden)
                    var iEditableTarget = self._cargaTargets[iNuevaCarga.toString()] || iCantidad;
                    oView.byId("slotQtyEditable").setValue(iEditableTarget.toString());
                    self._cargaActual = { noCarga: iNuevaCarga, cantidad: iCantidad };
                    self._updateProgressIndicator();
                    sap.m.MessageToast.show(oBundle.getText("cargaInitSuccess", [iNuevaCarga.toString(), iCantidad]));
                }).catch(function () {
                    oView.byId("idPluginPanel").setBusy(false);
                    sap.m.MessageToast.show(oBundle.getText("errorInitCarga"));
                });
            }).catch(function () {
                oView.byId("idPluginPanel").setBusy(false);
                sap.m.MessageToast.show(oBundle.getText("errorObtenerDatos"));
            });
        },


        /**
         * Actualizar indicador de progreso con un contador por carga (hasta 5 cargas).
         * Muestra "C1: Y/N", "C2: Y/N", ... para cada carga que exista.
         * La barra de progreso refleja la carga actual.
         * Los objetivos por carga se leen de this._cargaTargets.
         */
        _updateProgressIndicator: function () {
            var oView = this.getView();
            var oTableCin = oView.byId("idSlotTableCintas");
            var aItemsCin = (oTableCin && oTableCin.getModel()) ? (oTableCin.getModel().getProperty("/ITEMS") || []) : [];
            var iQtyCin = parseInt(oView.byId("slotQty_cintas").getValue() || "0", 10);
            var iQtyAlm = parseInt(oView.byId("slotQty_alambre").getValue() || "0", 10);
            var sNoCargaActual = oView.byId("noCarga").getValue() || "1";
            var iNoCargaActual = parseInt(sNoCargaActual, 10) || 1;

            // Contar slots ocupados de cintas agrupados por número de carga (parts[3])
            var oCargaCount = {};
            aItemsCin.forEach(function (s) {
                if (!s.value || !s.value.trim()) { return; }
                var sCargaSlot = s.value.split("!")[3] || "1";
                oCargaCount[sCargaSlot] = (oCargaCount[sCargaSlot] || 0) + 1;
            });

            // Actualizar contadores individuales C1..C5
            var aCounterIds = ["progressCounter", "progressCounter2", "progressCounter3", "progressCounter4", "progressCounter5"];
            for (var n = 1; n <= 5; n++) {
                var oCounter = oView.byId(aCounterIds[n - 1]);
                if (!oCounter) { continue; }
                if (n > iNoCargaActual) {
                    oCounter.setVisible(false);
                    oCounter.setText("");
                } else {
                    var sN = n.toString();
                    var iEscN = oCargaCount[sN] || 0;
                    var iTargetN = this._cargaTargets[sN]
                        ? this._cargaTargets[sN]
                        : ((this._suggestedQtyCintas && this._suggestedQtyCintas > 0) ? this._suggestedQtyCintas : iQtyCin);
                    var sCheck = (n < iNoCargaActual && iTargetN > 0 && iEscN >= iTargetN) ? " ✓" : "";
                    oCounter.setText("C" + sN + ": " + iEscN + "/" + (iTargetN || "?") + sCheck);
                    oCounter.setVisible(true);
                }
            }

            // Barra de progreso → refleja únicamente la carga actual
            var iEscActual = oCargaCount[sNoCargaActual] || 0;
            var iSugeridoActual = this._cargaTargets[sNoCargaActual]
                ? this._cargaTargets[sNoCargaActual]
                : ((this._suggestedQtyCintas && this._suggestedQtyCintas > 0) ? this._suggestedQtyCintas : iQtyCin);
            var oProgressBar = oView.byId("progressBar");
            if (oProgressBar && iSugeridoActual > 0) {
                var iPercent = Math.min(100, Math.round((iEscActual / iSugeridoActual) * 100));
                oProgressBar.setPercentValue(iPercent);
                oProgressBar.setDisplayValue(iPercent + "%");
                if (iEscActual === 0) { oProgressBar.setState("None"); }
                else if (iEscActual < iSugeridoActual) { oProgressBar.setState("Warning"); }
                else { oProgressBar.setState("Success"); }
            } else if (oProgressBar) {
                oProgressBar.setPercentValue(0);
                oProgressBar.setDisplayValue("0%");
                oProgressBar.setState("None");
            }

            // Sync slotQty visible con la tabla activa
            var sActiveKey = oView.byId("tableToggle").getSelectedKey() || "CINTAS";
            oView.byId("slotQty").setValue(sActiveKey === "CINTAS" ? iQtyCin.toString() : iQtyAlm.toString());
        },

        /**
         * Verificar si la carga está completa (ambas tablas) y mostrar mensaje de éxito
         */
        _checkCargaCompleta: function () {
            var oView = this.getView();
            var oTableCin = oView.byId("idSlotTableCintas");
            var oTableAlm = oView.byId("idSlotTableAlambre");
            var aItemsCin = (oTableCin && oTableCin.getModel()) ? (oTableCin.getModel().getProperty("/ITEMS") || []) : [];
            var aItemsAlm = (oTableAlm && oTableAlm.getModel()) ? (oTableAlm.getModel().getProperty("/ITEMS") || []) : [];

            var iQtyCin = parseInt(oView.byId("slotQty_cintas").getValue() || "0", 10);
            var iQtyAlm = parseInt(oView.byId("slotQty_alambre").getValue() || "0", 10);
            var iTotalQty = iQtyCin + iQtyAlm;

            var iEscCin = aItemsCin.filter(function (s) { return s.value && s.value.trim() !== ""; }).length;
            var iEscAlm = aItemsAlm.filter(function (s) { return s.value && s.value.trim() !== ""; }).length;
            var iEscaneados = iEscCin + iEscAlm;

            var sNoCarga = oView.byId("noCarga").getValue() || "0";
            var oBundle = oView.getModel("i18n").getResourceBundle();

            if (iTotalQty > 0 && iEscaneados === iTotalQty) {
                sap.m.MessageBox.success(
                    oBundle.getText("cargaCompletadaMensaje", [sNoCarga, iEscaneados, iTotalQty]),
                    { title: oBundle.getText("cargaCompletadaTitulo") }
                );
            }
        },

        /**
         * Obtener cantidad de cintas desde las características de la orden.
         * Si hay ORDENES_HIJAS, consulta todas para determinar el máximo (CT_100035_500 / CT_100038_500).
         * Monitorea ORDEN_PADRE para detectar cambio de orden y resetear el contador de cargas.
         */
        onGetOrderCustomValues: function () {
            var oView = this.getView();
            var oPODParams = this.Commons.getPODParams(this.getOwnerComponent());
            var self = this;

            var url = this.getPublicApiRestDataSourceUri() + this.ApiPaths.CHARACHTERISTICS;
            this.ajaxGetRequest(url, { plant: oPODParams.PLANT_ID, order: oPODParams.ORDER_ID },
                function (oResponseData) {
                    var oOrder = Array.isArray(oResponseData) ? oResponseData[0] : oResponseData;
                    var aCustomValues = (oOrder && oOrder.customValues) ? oOrder.customValues : [];

                    // Detectar cambio de ORDEN_PADRE → reset contador de cargas
                    var oOrdenPadreCv = aCustomValues.find(function (cv) { return cv.attribute === "ORDEN_PADRE"; });
                    var sNuevaOrdenPadre = (oOrdenPadreCv && oOrdenPadreCv.value) ? oOrdenPadreCv.value.trim() : oPODParams.ORDER_ID;
                    if (self._sOrdenPadre && self._sOrdenPadre !== sNuevaOrdenPadre) {
                        self._resetLoadCounter();
                    }
                    self._sOrdenPadre = sNuevaOrdenPadre;

                    // Recopilar todas las órdenes a consultar: actual + hijas
                    var aOrdenesAConsultar = [oPODParams.ORDER_ID];
                    var oOrdenesHijasCv = aCustomValues.find(function (cv) { return cv.attribute === "ORDENES_HIJAS"; });
                    if (oOrdenesHijasCv && oOrdenesHijasCv.value) {
                        var aHijas = oOrdenesHijasCv.value.split(',')
                            .map(function (s) {
                                // Normalizar al mismo formato que oPODParams.ORDER_ID:
                                // quitar ceros iniciales para que coincida con el formato corto de la API.
                                var sTrimmed = s.trim();
                                return sTrimmed ? String(parseInt(sTrimmed, 10)) : "";
                            })
                            .filter(Boolean);
                        aOrdenesAConsultar = aOrdenesAConsultar.concat(aHijas);
                    }

                    // Consultar todas las órdenes y obtener la cantidad mínima de cintas
                    self._getMinCintasFromOrders(oPODParams.PLANT_ID, aOrdenesAConsultar, function (iMinCintas, sRawValue) {
                        if (iMinCintas > 0) {
                            oView.byId("slotQtySuggest").setValue(sRawValue || String(iMinCintas));
                            self._suggestedQtyCintas = iMinCintas;
                            // Inicializar objetivo de la carga actual si no fue confirmado antes
                            var sNoCargaInit = oView.byId("noCarga").getValue() || "1";
                            if (!self._cargaTargets[sNoCargaInit]) {
                                self._cargaTargets[sNoCargaInit] = iMinCintas;
                            }
                            // Pre-poblar slotQtyEditable si aún no tiene un valor confirmado
                            var oEditableInput = oView.byId("slotQtyEditable");
                            if (oEditableInput && !oEditableInput.getValue()) {
                                oEditableInput.setValue(String(self._cargaTargets[sNoCargaInit] || iMinCintas));
                            }
                            self._updateProgressIndicator();
                            // Disparar auto-init si NO_CARGA era 0 cuando onGetCustomValues corrió
                            if (self._pendingAutoInit) {
                                self._pendingAutoInit = false;
                                self._iniciarNuevaCarga(iMinCintas);
                            }
                        } else {
                            oView.byId("slotQtySuggest").setValue("");
                            self._suggestedQtyCintas = 0;
                        }
                    });
                },
                function (oError, sHttpErrorMessage) {
                    sap.m.MessageToast.show(oError || sHttpErrorMessage);
                }
            );
        },

        /**
         * Consulta múltiples órdenes y retorna la cantidad mínima de cintas encontrada
         * en CT_100035_500 o CT_100038_500.
         * @param {string} sPlant - Planta
         * @param {string[]} aOrderIds - IDs de órdenes a consultar
         * @param {function} fCallback - Callback(iMinCintas, sRawValue)
         */
        _getMinCintasFromOrders: function (sPlant, aOrderIds, fCallback) {
            var self = this;
            var oSapApi = this.getPublicApiRestDataSourceUri();
            var iMinCintas = 0;
            var sMinRawValue = "";
            var iRemaining = aOrderIds.length;
            if (!iRemaining) { fCallback(0, ""); return; }

            aOrderIds.forEach(function (sOrder) {
                self.ajaxGetRequest(oSapApi + self.ApiPaths.CHARACHTERISTICS, { plant: sPlant, order: sOrder },
                    function (oResponseData) {
                        var oOrd = Array.isArray(oResponseData) ? oResponseData[0] : oResponseData;
                        var aCVs = (oOrd && oOrd.customValues) ? oOrd.customValues : [];
                        var oCV = aCVs.find(function (cv) { return cv.attribute === "CT_100035_500" && cv.value; }) ||
                                  aCVs.find(function (cv) { return cv.attribute === "CT_100038_500" && cv.value; });
                        if (oCV && oCV.value) {
                            var iQty = parseInt((oCV.value.trim().split(' ')[0]) || "0", 10) || 0;
                            if (iQty > 0 && (iMinCintas === 0 || iQty < iMinCintas)) {
                                iMinCintas = iQty;
                                sMinRawValue = oCV.value.trim();
                            }
                        }
                        if (--iRemaining === 0) { fCallback(iMinCintas, sMinRawValue); }
                    },
                    function () {
                        if (--iRemaining === 0) { fCallback(iMinCintas, sMinRawValue); }
                    }
                );
            });
        },

        /**
         * Resetear el contador de cargas (NO_CARGA = 0) cuando cambia la ORDEN_PADRE.
         * También limpia los objetivos CARGA_1..CARGA_5, vacía todos los slots escaneados
         * en el backend y limpia los modelos de ambas tablas en la UI.
         * Activa _pendingAutoInit para que onGetOrderCustomValues inicie la carga 1 automáticamente.
         */
        _resetLoadCounter: function () {
            var oView = this.getView();
            var oPODParams = this.Commons.getPODParams(this.getOwnerComponent());
            var oSapApi = this.getPublicApiRestDataSourceUri();
            var self = this;
            var aCargaKeys = ["CARGA_1", "CARGA_2", "CARGA_3", "CARGA_4", "CARGA_5"];
            // Activar auto-init inmediatamente para que _getMinCintasFromOrders
            // inicie la carga 1 en cuanto tenga la cantidad de cintas de la nueva orden.
            this._pendingAutoInit = true;
            var sParams = { plant: oPODParams.PLANT_ID, workCenter: oPODParams.WORK_CENTER };
            this.getWorkCenterCustomValues(sParams, oSapApi).then(function (oRes) {
                if (!oRes || oRes === "Error" || !oRes.customValues) { return; }
                var aFinal = oRes.customValues.map(function (cv) {
                    if (cv.attribute === "NO_CARGA") { return { attribute: "NO_CARGA", value: "0" }; }
                    if (aCargaKeys.indexOf(cv.attribute) !== -1) { return { attribute: cv.attribute, value: "" }; }
                    // Vaciar todos los slots escaneados
                    if (/^SLOT\d{3}$/.test(cv.attribute)) { return { attribute: cv.attribute, value: "" }; }
                    return cv;
                });
                // Limpiar objetivos de carga y modelos de tabla en memoria
                self._cargaTargets = {};
                var oTableCin = oView.byId("idSlotTableCintas");
                var oTableAlm = oView.byId("idSlotTableAlambre");
                if (oTableCin && oTableCin.getModel()) {
                    var aSlotsCin = oTableCin.getModel().getProperty("/ITEMS") || [];
                    aSlotsCin.forEach(function (s) { s.value = ""; s.loteQty = ""; s.loteUom = ""; s.cantidadAsignada = ""; });
                    oTableCin.getModel().refresh(true);
                }
                if (oTableAlm && oTableAlm.getModel()) {
                    var aSlotsAlm = oTableAlm.getModel().getProperty("/ITEMS") || [];
                    aSlotsAlm.forEach(function (s) { s.value = ""; s.loteQty = ""; s.loteUom = ""; s.cantidadAsignada = ""; });
                    oTableAlm.getModel().refresh(true);
                }
                self._updateProgressIndicator();
                self._updateOrderSummaryScannedQty([], []);
                self.setCustomValuesPp({ inCustomValues: aFinal, inPlant: oPODParams.PLANT_ID, inWorkCenter: oPODParams.WORK_CENTER }, oSapApi).then(function () {
                    oView.byId("noCarga").setValue("0");
                });
            });
        },

        /**
         * Refrescar la tabla de alambre desde backend (sin afectar los slots de cintas).
         */
        onRefreshCintas: function () {
            this._refreshLoteQtyBothTables();
        },

        onRefreshAlambre: function () {
            this._refreshLoteQtyBothTables();
        },

        /**
         * Refresca loteQty y loteUom de todos los slots con valor (Cintas + Alambre)
         * consultando getReservas por cada lote. Solo lectura, no persiste nada.
         */
        _refreshLoteQtyBothTables: function () {
            var oView = this.getView();
            var oBundle = oView.getModel("i18n").getResourceBundle();
            var oPODParams = this.Commons.getPODParams(this.getOwnerComponent());
            var mandante = this.getConfiguration().mandante;
            var oSapApi = this.getPublicApiRestDataSourceUri();
            var urlLote = oSapApi + this.ApiPaths.getReservas;

            var oTableCin = oView.byId("idSlotTableCintas");
            var oTableAlm = oView.byId("idSlotTableAlambre");
            var oModelCin = oTableCin ? oTableCin.getModel() : null;
            var oModelAlm = oTableAlm ? oTableAlm.getModel() : null;

            var aItemsCin = (oModelCin && oModelCin.getProperty("/ITEMS")) || [];
            var aItemsAlm = (oModelAlm && oModelAlm.getProperty("/ITEMS")) || [];

            var aSlotsConValor = aItemsCin
                .filter(function (s) { return s.value && s.value.trim() !== ""; })
                .concat(aItemsAlm.filter(function (s) { return s.value && s.value.trim() !== ""; }));

            if (aSlotsConValor.length === 0) {
                sap.m.MessageToast.show(oBundle.getText("sinLotesParaRefrescar"));
                return;
            }

            oView.byId("idPluginPanel").setBusy(true);

            var aPromises = aSlotsConValor.map(function (slot) {
                var parts = slot.value.split("!");
                var sMaterial = (parts[0] || "").trim();
                var sLote = (parts[1] || "").trim();

                var inParams = {
                    "inPlanta": oPODParams.PLANT_ID,
                    "inLote": sLote,
                    "inOrden": oPODParams.ORDER_ID,
                    "inSapClient": mandante,
                    "inMaterial": sMaterial,
                    "inPuesto": oPODParams.WORK_CENTER
                };

                return new Promise(function (resolve) {
                    this.ajaxPostRequest(urlLote, inParams,
                        function (oRes) {
                            var sNuevaQtyKg = parseFloat(oRes.outCantidadLote || 0).toFixed(2);
                            var sPartsSlot = slot.value.split('!');
                            slot.loteQty = this._formatLoteQty(oRes.outCantidadLote);
                            slot.loteUom = oRes.outOUMLote || "";
                            slot.cantidadAsignada = slot.loteQty;
                            // Actualizar slot.value: MAT!LOTE!NUEVA_CANTIDAD!NO_CARGA!NUEVA_CANTIDAD_PENDIENTE
                            slot.value = sPartsSlot[0] + '!' + sPartsSlot[1] + '!' + sNuevaQtyKg + '!' + (sPartsSlot[3] || "") + '!' + sNuevaQtyKg;
                            resolve({ ok: true });
                        }.bind(this),
                        function () {
                            resolve({ ok: false });
                        }.bind(this)
                    );
                }.bind(this));
            }.bind(this));

            Promise.all(aPromises).then(function (aResults) {
                oView.byId("idPluginPanel").setBusy(false);

                if (oModelCin) { oModelCin.refresh(true); }
                if (oModelAlm) { oModelAlm.refresh(true); }

                var aFinalCin = (oModelCin && oModelCin.getProperty("/ITEMS")) || [];
                var aFinalAlm = (oModelAlm && oModelAlm.getProperty("/ITEMS")) || [];
                this._updateOrderSummaryScannedQty(aFinalCin, aFinalAlm);

                // Persistir las cantidades actualizadas en los custom values del puesto
                var aEditedRefresh = aFinalCin.concat(aFinalAlm).map(function (slot) {
                    return { attribute: slot.attribute, value: slot.value || "" };
                });
                var sParamsWC = { plant: oPODParams.PLANT_ID, workCenter: oPODParams.WORK_CENTER };
                this.getWorkCenterCustomValues(sParamsWC, oSapApi).then(function (oOriginalRes) {
                    var aOriginal = this._getValidatedCustomValues(oOriginalRes, oBundle);
                    if (!aOriginal) { return; }
                    var aEditMap = {};
                    aEditedRefresh.forEach(function (item) { aEditMap[item.attribute] = item.value; });
                    var aFinalCV = aOriginal.map(function (item) {
                        return { attribute: item.attribute, value: aEditMap.hasOwnProperty(item.attribute) ? aEditMap[item.attribute] : item.value };
                    });
                    for (var sKey in aEditMap) {
                        if (!aFinalCV.find(function (i) { return i.attribute === sKey; })) {
                            aFinalCV.push({ attribute: sKey, value: aEditMap[sKey] });
                        }
                    }
                    this.setCustomValuesPp({ inCustomValues: aFinalCV, inPlant: oPODParams.PLANT_ID, inWorkCenter: oPODParams.WORK_CENTER }, oSapApi);
                }.bind(this));

                var iFailed = aResults.filter(function (r) { return !r.ok; }).length;
                if (iFailed > 0) {
                    sap.m.MessageToast.show(oBundle.getText("refreshParcial", [iFailed]));
                } else {
                    sap.m.MessageToast.show(oBundle.getText("refreshExitoso"));
                }
            }.bind(this));
        },

        onExit: function () {
            PluginViewController.prototype.onExit.apply(this, arguments);
            this.unsubscribe("phaseSelectionEvent", this.onPhaseSelectionEventCustom, this);

        }
    });
});